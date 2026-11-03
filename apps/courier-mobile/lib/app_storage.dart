import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class OfflineQueueItem {
  OfflineQueueItem({
    required this.id,
    required this.method,
    required this.path,
    this.body,
    this.headers,
    required this.createdAt,
    this.rejection,
  });

  final String id;
  final String method;
  final String path;
  final Object? body;
  final Map<String, String>? headers;
  final DateTime createdAt;
  final String? rejection;

  Map<String, dynamic> toJson() => {
        'id': id,
        'method': method,
        'path': path,
        'body': body,
        'headers': headers,
        'createdAt': createdAt.toIso8601String(),
        'rejection': rejection,
      };

  factory OfflineQueueItem.fromJson(Map<String, dynamic> json) => OfflineQueueItem(
        id: json['id'] as String,
        method: json['method'] as String,
        path: json['path'] as String,
        body: json['body'],
        headers: (json['headers'] as Map?)?.map((key, value) => MapEntry(key.toString(), value.toString())),
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '') ?? DateTime.now(),
        rejection: json['rejection']?.toString(),
      );
}

class AppStorage {
  AppStorage(this._preferences, this._secureStorage);

  final SharedPreferences _preferences;
  final FlutterSecureStorage _secureStorage;
  final Random _random = Random.secure();

  static const _sessionKey = 'delivery.session.v1';
  static const _queueKey = 'delivery.offline_queue.v1';
  static const _rejectedKey = 'delivery.offline_rejected.v1';
  static const _cachePrefix = 'delivery.cache.';
  static const _localeKey = 'delivery.locale.v1';

  static Future<AppStorage> open() async {
    final preferences = await SharedPreferences.getInstance();
    return AppStorage(preferences, const FlutterSecureStorage());
  }

  Future<void> saveSession(Map<String, dynamic> session) =>
      _secureStorage.write(key: _sessionKey, value: jsonEncode(session));

  Future<Map<String, dynamic>?> readSession() async {
    final value = await _secureStorage.read(key: _sessionKey);
    if (value == null || value.isEmpty) return null;
    try {
      final decoded = jsonDecode(value);
      return decoded is Map ? Map<String, dynamic>.from(decoded) : null;
    } catch (_) {
      await clearSession();
      return null;
    }
  }

  Future<void> clearSession() => _secureStorage.delete(key: _sessionKey);

  Future<void> cacheResponse(String path, dynamic value) async {
    try {
      await _secureStorage.write(
        key: '$_cachePrefix$path',
        value: jsonEncode(value),
      );
      await _preferences.remove('$_cachePrefix$path');
    } catch (_) {
      // Cache writes are best effort and must never fail a live request.
    }
  }

  String newOperationId() =>
      '${DateTime.now().microsecondsSinceEpoch}_${_random.nextInt(1 << 32).toRadixString(36)}';

  Future<DateTime?> readLastLocationSync() async {
    final value = await _secureStorage.read(key: 'delivery.location_sync.v1');
    return value == null ? null : DateTime.tryParse(value);
  }

  Future<void> saveLastLocationSync(DateTime value) => _secureStorage.write(
        key: 'delivery.location_sync.v1',
        value: value.toIso8601String(),
      );

  Future<bool> hasLocationConsent() async =>
      await _secureStorage.read(key: 'delivery.location_consent.v1') == 'true';

  Future<void> saveLocationConsent(bool accepted) => _secureStorage.write(
        key: 'delivery.location_consent.v1',
        value: accepted ? 'true' : 'false',
      );

  Future<dynamic> readCachedResponse(String path) async {
    final key = '$_cachePrefix$path';
    var value = await _secureStorage.read(key: key);
    if (value == null) {
      value = _preferences.getString(key);
      if (value != null) {
        await _secureStorage.write(key: key, value: value);
        await _preferences.remove(key);
      }
    }
    if (value == null) return null;
    try {
      return jsonDecode(value);
    } catch (_) {
      return null;
    }
  }

  Future<List<OfflineQueueItem>> queue() async {
    var raw = await _secureStorage.read(key: _queueKey);
    var migrated = false;
    if (raw == null) {
      raw = _preferences.getString(_queueKey);
      if (raw != null) {
        await _secureStorage.write(key: _queueKey, value: raw);
        await _preferences.remove(_queueKey);
        migrated = true;
      }
    }
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      final items = decoded
          .whereType<Map>()
          .map((item) => OfflineQueueItem.fromJson(Map<String, dynamic>.from(item)))
          .toList();
      if (migrated) {
        final upgraded = items.map((item) {
          final needsIdempotency =
              item.path == '/v1/courier/location' ||
              item.path.startsWith('/v1/courier/deliveries/');
          if (!needsIdempotency || item.headers?['idempotency-key'] != null) {
            return item;
          }
          return OfflineQueueItem(
            id: item.id,
            method: item.method,
            path: item.path,
            body: item.body,
            headers: {...?item.headers, 'idempotency-key': item.id},
            createdAt: item.createdAt,
            rejection: item.rejection,
          );
        }).toList();
        await _writeQueue(upgraded);
        return upgraded;
      }
      return items;
    } catch (_) {
      return [];
    }
  }

  Future<void> enqueue({
    required String method,
    required String path,
    Object? body,
    Map<String, String>? headers,
    required String operationId,
  }) async {
    final items = await queue();
    items.add(OfflineQueueItem(
      id: operationId,
      method: method,
      path: path,
      body: body,
      headers: headers,
      createdAt: DateTime.now(),
    ));
    if (path == '/v1/courier/location') {
      final locationItems = items
          .where((item) => item.path == '/v1/courier/location')
          .toList();
      if (locationItems.length > 100) {
        final excess = locationItems.length - 100;
        final expired = locationItems.take(excess).toList();
        final oldestIds = expired.map((item) => item.id).toSet();
        items.removeWhere((item) => oldestIds.contains(item.id));
        final rejected = await rejectedQueue();
        rejected.addAll(expired.map((item) => OfflineQueueItem(
              id: item.id,
              method: item.method,
              path: item.path,
              body: item.body,
              headers: item.headers,
              createdAt: item.createdAt,
              rejection: 'This location sample expired before synchronization because the offline queue limit was reached.',
            )));
        if (rejected.length > 50) rejected.removeRange(0, rejected.length - 50);
        await _writeRejected(rejected);
      }
    }
    await _writeQueue(items);
  }

  Future<void> removeQueued(String id) async {
    final items = (await queue())..removeWhere((item) => item.id == id);
    await _writeQueue(items);
  }

  Future<void> rejectQueued(String id, String reason) async {
    final items = await queue();
    final index = items.indexWhere((item) => item.id == id);
    if (index < 0) return;
    final item = items.removeAt(index);
    final rejected = await rejectedQueue();
    rejected.add(OfflineQueueItem(
      id: item.id,
      method: item.method,
      path: item.path,
      body: item.body,
      headers: item.headers,
      createdAt: item.createdAt,
      rejection: reason,
    ));
    if (rejected.length > 50) rejected.removeRange(0, rejected.length - 50);
    await _writeQueue(items);
    await _writeRejected(rejected);
  }

  Future<void> recordRejected({
    required String id,
    required String method,
    required String path,
    Object? body,
    Map<String, String>? headers,
    required String reason,
  }) async {
    final rejected = await rejectedQueue();
    if (rejected.any((item) => item.path == path && item.rejection == reason)) {
      return;
    }
    rejected.add(OfflineQueueItem(
      id: id,
      method: method,
      path: path,
      body: body,
      headers: headers,
      createdAt: DateTime.now(),
      rejection: reason,
    ));
    if (rejected.length > 50) rejected.removeRange(0, rejected.length - 50);
    await _writeRejected(rejected);
  }

  Future<List<OfflineQueueItem>> rejectedQueue() async {
    final raw = await _secureStorage.read(key: _rejectedKey);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      return decoded
          .whereType<Map>()
          .map((item) => OfflineQueueItem.fromJson(Map<String, dynamic>.from(item)))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> clearRejected() => _secureStorage.delete(key: _rejectedKey);

  Future<void> clearQueued() async {
    await _secureStorage.delete(key: _queueKey);
    await _secureStorage.delete(key: _rejectedKey);
    await _preferences.remove(_queueKey);
  }

  Future<void> clearSensitiveData() async {
    await _secureStorage.deleteAll();
    for (final key in _preferences.getKeys()) {
      if (key == _queueKey || key.startsWith(_cachePrefix)) {
        await _preferences.remove(key);
      }
    }
  }

  Future<void> _writeQueue(List<OfflineQueueItem> items) => _secureStorage.write(
        key: _queueKey,
        value: jsonEncode(items.map((item) => item.toJson()).toList()),
      );

  Future<void> _writeRejected(List<OfflineQueueItem> items) => _secureStorage.write(
        key: _rejectedKey,
        value: jsonEncode(items.map((item) => item.toJson()).toList()),
      );

  String? get localeCode => _preferences.getString(_localeKey);

  Future<void> setLocaleCode(String? code) async {
    if (code == null || code.isEmpty) {
      await _preferences.remove(_localeKey);
    } else {
      await _preferences.setString(_localeKey, code);
    }
  }
}
