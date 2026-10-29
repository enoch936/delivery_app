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
  });

  final String id;
  final String method;
  final String path;
  final Object? body;
  final Map<String, String>? headers;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'method': method,
        'path': path,
        'body': body,
        'headers': headers,
        'createdAt': createdAt.toIso8601String(),
      };

  factory OfflineQueueItem.fromJson(Map<String, dynamic> json) => OfflineQueueItem(
        id: json['id'] as String,
        method: json['method'] as String,
        path: json['path'] as String,
        body: json['body'],
        headers: (json['headers'] as Map?)?.map((key, value) => MapEntry(key.toString(), value.toString())),
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '') ?? DateTime.now(),
      );
}

class AppStorage {
  AppStorage(this._preferences, this._secureStorage);

  final SharedPreferences _preferences;
  final FlutterSecureStorage _secureStorage;
  final Random _random = Random.secure();

  static const _sessionKey = 'delivery.session.v1';
  static const _queueKey = 'delivery.offline_queue.v1';
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
      await _preferences.setString('$_cachePrefix$path', jsonEncode(value));
    } catch (_) {
      // Cache writes are best effort and must never fail a live request.
    }
  }

  dynamic readCachedResponse(String path) {
    final value = _preferences.getString('$_cachePrefix$path');
    if (value == null) return null;
    try {
      return jsonDecode(value);
    } catch (_) {
      return null;
    }
  }

  List<OfflineQueueItem> queue() {
    final raw = _preferences.getString(_queueKey);
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

  Future<void> enqueue({
    required String method,
    required String path,
    Object? body,
    Map<String, String>? headers,
  }) async {
    final items = queue();
    final id = '${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 32)}';
    items.add(OfflineQueueItem(
      id: id,
      method: method,
      path: path,
      body: body,
      headers: headers,
      createdAt: DateTime.now(),
    ));
    await _writeQueue(items);
  }

  Future<void> removeQueued(String id) async {
    final items = queue()..removeWhere((item) => item.id == id);
    await _writeQueue(items);
  }

  Future<void> clearQueued() async {
    await _preferences.remove(_queueKey);
  }

  Future<void> _writeQueue(List<OfflineQueueItem> items) async {
    await _preferences.setString(
      _queueKey,
      jsonEncode(items.map((item) => item.toJson()).toList()),
    );
  }

  String? get localeCode => _preferences.getString(_localeKey);

  Future<void> setLocaleCode(String? code) async {
    if (code == null || code.isEmpty) {
      await _preferences.remove(_localeKey);
    } else {
      await _preferences.setString(_localeKey, code);
    }
  }
}
