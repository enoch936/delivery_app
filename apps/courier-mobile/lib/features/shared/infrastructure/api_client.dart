import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;

import '../../shared/domain/models.dart';
import '../../shared/domain/formatters.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000/api',
);

class ApiClient {
  ApiClient(this.storage);

  final AppStorage storage;
  final ValueNotifier<int> pendingSync = ValueNotifier(0);
  Session? session;
  StreamSubscription<List<ConnectivityResult>>? _connectivity;
  bool _flushing = false;
  bool offline = false;

  Future<dynamic> get(String path) => _send('GET', path);

  Future<dynamic> post(String path, [Object? body, Map<String, String>? headers]) =>
      _send('POST', path, body: body, headers: headers);

  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body: body);

  Future<dynamic> delete(String path) => _send('DELETE', path);

  String? get accessToken => session?.accessToken;

  Future<void> restoreSession() async {
    final json = await storage.readSession();
    if (json != null) {
      try {
        session = Session.fromJson(json);
      } catch (_) {
        await storage.clearSession();
      }
    }
    pendingSync.value = storage.queue().length;
  }

  Future<void> startSync() async {
    pendingSync.value = storage.queue().length;
    _connectivity = Connectivity().onConnectivityChanged.listen((results) {
      final online = results.any((result) => result != ConnectivityResult.none);
      offline = !online;
      if (online) unawaited(flushQueue());
    });
    await flushQueue();
  }

  Future<dynamic> postQueued(String path, [Object? body, Map<String, String>? headers]) async {
    try {
      return await post(path, body, headers);
    } on ApiException catch (error) {
      if (error.statusCode != 0) rethrow;
      await storage.enqueue(method: 'POST', path: path, body: body, headers: headers);
      pendingSync.value = storage.queue().length;
      return {'queued': true};
    }
  }

  Future<dynamic> putQueued(String path, [Object? body]) async {
    try {
      return await put(path, body);
    } on ApiException catch (error) {
      if (error.statusCode != 0) rethrow;
      await storage.enqueue(method: 'PUT', path: path, body: body);
      pendingSync.value = storage.queue().length;
      return {'queued': true};
    }
  }

  Future<int> flushQueue() async {
    if (_flushing || session == null) return storage.queue().length;
    _flushing = true;
    try {
      for (final item in storage.queue()) {
        try {
          await _send(item.method, item.path, body: item.body, headers: item.headers);
          await storage.removeQueued(item.id);
        } on ApiException catch (error) {
          final permanent = error.statusCode >= 400 && error.statusCode < 500 && error.statusCode != 408 && error.statusCode != 429;
          if (permanent) {
            await storage.removeQueued(item.id);
            continue;
          }
          break;
        } catch (_) {
          break;
        }
      }
      pendingSync.value = storage.queue().length;
      return pendingSync.value;
    } finally {
      _flushing = false;
    }
  }

  Future<dynamic> _send(
    String method,
    String path, {
    Object? body,
    Map<String, String>? headers,
    bool auth = true,
    bool retry = true,
  }) async {
    try {
      final request = http.Request(method, Uri.parse('$apiBaseUrl$path'));
      request.headers['content-type'] = 'application/json';
      if (headers != null) request.headers.addAll(headers);
      if (auth && session != null) {
        request.headers['authorization'] = 'Bearer ${session!.accessToken}';
      }
      if (body != null) request.body = jsonEncode(body);
      final response = await request.send();
      final text = await response.stream.bytesToString();
      dynamic decoded;
      if (text.isNotEmpty) {
        try {
          decoded = jsonDecode(text);
        } catch (_) {
          decoded = text;
        }
      }
      if (response.statusCode >= 200 && response.statusCode < 300) {
        offline = false;
        if (method == 'GET' && path.startsWith('/v1/') && !path.contains('/auth/')) {
          await storage.cacheResponse(path, decoded);
        }
        return decoded;
      }
      if (response.statusCode == 401 && auth && retry) {
        if (await _refresh()) {
          return await _send(method, path, body: body, headers: headers, retry: false);
        }
        session = null;
        await storage.clearSession();
      }
      throw ApiException(_message(decoded, response.statusCode), response.statusCode);
    } on SocketException catch (error) {
      return _networkFailure(method, path, error.message);
    } on HttpException catch (error) {
      return _networkFailure(method, path, error.message);
    } on FormatException {
      return _networkFailure(method, path, 'The request timed out.');
    }
  }

  dynamic _networkFailure(String method, String path, String message) {
    offline = true;
    if (method == 'GET') {
      final cached = storage.readCachedResponse(path);
      if (cached != null) return cached;
    }
    throw ApiException('You are offline. $message', 0);
  }

  Future<bool> _refresh() async {
    final current = session;
    if (current == null) return false;
    try {
      final result = await _send(
        'POST',
        '/v1/auth/refresh',
        body: {'refreshToken': current.refreshToken},
        auth: false,
        retry: false,
      );
      session = Session.fromJson(asMap(result));
      await storage.saveSession(session!.toJson());
      return true;
    } catch (_) {
      return false;
    }
  }

  String _message(dynamic body, int status) {
    if (body is Map && body['message'] != null) {
      final message = body['message'];
      if (message is List) return message.join(', ');
      return message.toString();
    }
    return 'Request failed ($status)';
  }

  Future<Map<String, dynamic>> requestOtp(String phone) async {
    final result = await _send(
      'POST',
      '/v1/auth/otp/request',
      body: {'phoneE164': phone},
      auth: false,
    );
    return asMap(result);
  }

  Future<Session> verifyOtp(String phone, String code, String challengeId) async {
    final result = await _send(
      'POST',
      '/v1/auth/otp/verify',
      body: {'phoneE164': phone, 'code': code, 'challengeId': challengeId},
      auth: false,
    );
    session = Session.fromJson(asMap(result));
    await storage.saveSession(session!.toJson());
    return session!;
  }

  Future<void> signOut() async {
    final current = session;
    session = null;
    await storage.clearSession();
    await storage.clearQueued();
    pendingSync.value = 0;
    if (current == null) return;
    try {
      await _send('POST', '/v1/auth/logout', body: {'refreshToken': current.refreshToken}, auth: false, retry: false);
    } catch (_) {
      // Local credentials are discarded even when the server session expired.
    }
  }

  void dispose() {
    _connectivity?.cancel();
  }
}
