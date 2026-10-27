import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
const firebaseMessagingSenderId = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
const firebaseStorageBucket = String.fromEnvironment('FIREBASE_STORAGE_BUCKET');
const firebaseIosBundleId = String.fromEnvironment('FIREBASE_IOS_BUNDLE_ID');

bool get firebaseConfigured =>
    firebaseApiKey.isNotEmpty &&
    firebaseAppId.isNotEmpty &&
    firebaseMessagingSenderId.isNotEmpty &&
    firebaseProjectId.isNotEmpty;

FirebaseOptions get firebaseOptions => FirebaseOptions(
      apiKey: firebaseApiKey,
      appId: firebaseAppId,
      messagingSenderId: firebaseMessagingSenderId,
      projectId: firebaseProjectId,
      storageBucket: firebaseStorageBucket.isEmpty ? null : firebaseStorageBucket,
      iosBundleId: firebaseIosBundleId.isEmpty ? null : firebaseIosBundleId,
    );

@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  if (!firebaseConfigured) return;
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(options: firebaseOptions);
  }
}

class PushService {
  PushService({
    required this.app,
    required Future<dynamic> Function(String path, Object? body) post,
    required Future<dynamic> Function(String path) delete,
    required bool Function() hasSession,
    this.messengerKey,
  })  : _post = post,
        _delete = delete,
        _hasSession = hasSession;

  final String app;
  final GlobalKey<ScaffoldMessengerState>? messengerKey;
  final Future<dynamic> Function(String path, Object? body) _post;
  final Future<dynamic> Function(String path) _delete;
  final bool Function() _hasSession;

  String? _token;
  StreamSubscription<String>? _tokenRefresh;
  StreamSubscription<RemoteMessage>? _foregroundMessages;
  bool _initialized = false;
  bool _permissionDenied = false;

  bool get available => _initialized && _token != null && !_permissionDenied;

  Future<void> initialize() async {
    if (_initialized || !firebaseConfigured) return;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(options: firebaseOptions);
      }
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );
      _permissionDenied = settings.authorizationStatus == AuthorizationStatus.denied;
      if (_permissionDenied || !Platform.isAndroid && !Platform.isIOS) return;
      _token = await FirebaseMessaging.instance.getToken();
      _tokenRefresh = FirebaseMessaging.instance.onTokenRefresh.listen((token) {
        _token = token;
        unawaited(registerForSession());
      });
      _foregroundMessages = FirebaseMessaging.onMessage.listen(_showForegroundMessage);
      _initialized = true;
    } catch (error) {
      debugPrint('Push notifications are unavailable: $error');
    }
  }

  Future<void> registerForSession() async {
    await initialize();
    final token = _token;
    if (token == null || !_hasSession()) return;
    try {
      await _post('/v1/devices', {
        'token': token,
        'platform': Platform.isAndroid ? 'android' : Platform.isIOS ? 'ios' : 'other',
        'app': app,
        'appVersion': String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0'),
      });
    } catch (error) {
      debugPrint('Device push registration failed: $error');
    }
  }

  Future<void> unregister() async {
    final token = _token;
    if (token == null) return;
    try {
      await _delete('/v1/devices/${Uri.encodeComponent(token)}');
    } catch (_) {
      // Device cleanup is best effort; backend revokes the token on next login.
    }
  }

  void _showForegroundMessage(RemoteMessage message) {
    final notification = message.notification;
    final title = notification?.title ?? message.data['title']?.toString();
    final body = notification?.body ?? message.data['body']?.toString();
    if (title == null && body == null) return;
    messengerKey?.currentState?.showSnackBar(
      SnackBar(content: Text([title, body].whereType<String>().join(' · '))),
    );
  }

  Future<void> dispose() async {
    await _tokenRefresh?.cancel();
    await _foregroundMessages?.cancel();
  }
}
