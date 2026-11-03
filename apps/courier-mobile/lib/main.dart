import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import 'delivery_execution_screen.dart';
import 'design/floating_bars.dart';

import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import 'app_localizations.dart';
import 'app_storage.dart';
import 'location_service.dart';
import 'push_service.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://delivery-app-api-v2i0.onrender.com/api',
);

final scaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final storage = await AppStorage.open();
  final client = ApiClient(storage);
  await client.restoreSession();
  await client.startSync();
  final push = PushService(
    app: 'courier',
    post: client.post,
    delete: client.delete,
    hasSession: () => client.session != null,
    messengerKey: scaffoldMessengerKey,
  );
  await push.initialize();
  runApp(CourierApp(client: client, storage: storage, push: push));
}

class CourierApp extends StatefulWidget {
  const CourierApp({
    super.key,
    required this.client,
    required this.storage,
    required this.push,
  });

  final ApiClient client;
  final AppStorage storage;
  final PushService push;

  @override
  State<CourierApp> createState() => _CourierAppState();
}

class _CourierAppState extends State<CourierApp> {
  Locale? _locale;

  @override
  void initState() {
    super.initState();
    final code = widget.storage.localeCode;
    if (code != null && code.isNotEmpty) _locale = Locale(code);
  }

  void _changeLocale(String code) {
    setState(() => _locale = Locale(code));
    unawaited(widget.storage.setLocaleCode(code));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF2F6B4F),
      brightness: Brightness.light,
      surface: const Color(0xFFFFFDF7),
    );
    return MaterialApp(
      title: 'delivery_app courier',
      debugShowCheckedModeBanner: false,
      locale: _locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: const Color(0xFFF4F1E7),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFFF4F1E7),
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          titleTextStyle: TextStyle(
            color: Color(0xFF20261F),
            fontSize: 22,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.6,
          ),
        ),
        cardTheme: const CardThemeData(
          color: Color(0xFFFFFDF7),
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(18)),
            side: BorderSide(color: Color(0xFFD9D5C7)),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFD9D5C7)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFD9D5C7)),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFF1E2A24),
            foregroundColor: Colors.white,
            minimumSize: const Size(0, 50),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFF20261F),
            side: const BorderSide(color: Color(0xFFD9D5C7)),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ),
      builder: (context, child) => ScaffoldMessenger(
        key: scaffoldMessengerKey,
        child: child ?? const SizedBox.shrink(),
      ),
      home: CourierGate(
        client: widget.client,
        push: widget.push,
        onLocaleChanged: _changeLocale,
      ),
    );
  }
}

class Session {
  Session({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
  });

  final String accessToken;
  final String refreshToken;
  final Map<String, dynamic> user;

  factory Session.fromJson(Map<String, dynamic> json) => Session(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    user: asMap(json['user']),
  );

  Map<String, dynamic> toJson() => {
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'user': user,
  };
}

class ApiException implements Exception {
  ApiException(this.message, [this.statusCode = 0]);
  final String message;
  final int statusCode;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient(this.storage);

  final HttpClient _http = HttpClient();
  final AppStorage storage;
  final ValueNotifier<int> pendingSync = ValueNotifier(0);
  final ValueNotifier<int> rejectedSync = ValueNotifier(0);
  final ValueNotifier<bool> connected = ValueNotifier(true);
  final ValueNotifier<DateTime?> lastLocationSync = ValueNotifier(null);
  Session? session;
  bool _flushing = false;
  bool offline = false;

  Future<dynamic> get(String path) => _send('GET', path);

  Future<dynamic> post(
    String path, [
    Object? body,
    Map<String, String>? headers,
  ]) => _send('POST', path, body: body, headers: headers);

  Future<dynamic> put(String path, [Object? body]) =>
      _send('PUT', path, body: body);

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
    pendingSync.value = (await storage.queue()).length;
    rejectedSync.value = (await storage.rejectedQueue()).length;
    lastLocationSync.value = await storage.readLastLocationSync();
  }

  Future<void> startSync() async {
    pendingSync.value = (await storage.queue()).length;
    final initialConnectivity = await Connectivity().checkConnectivity();
    _updateConnectivity(initialConnectivity);
    Connectivity().onConnectivityChanged.listen((results) {
      _updateConnectivity(results);
    });
    await flushQueue();
  }

  void _updateConnectivity(List<ConnectivityResult> results) {
    final online = results.any((result) => result != ConnectivityResult.none);
    offline = !online;
    connected.value = online;
    if (online) unawaited(flushQueue());
  }

  Future<dynamic> postQueued(
    String path, [
    Object? body,
    Map<String, String>? headers,
  ]) async {
    if (path.startsWith('/v1/courier/deliveries/')) {
      final queued = (await storage.queue()).where(
        (item) => item.method == 'POST' && item.path == path,
      );
      if (queued.isNotEmpty) {
        return {'queued': true, 'operationId': queued.first.id};
      }
    }
    final operationId = headers?['idempotency-key'] ?? storage.newOperationId();
    final operationHeaders = {...?headers, 'idempotency-key': operationId};
    try {
      return await post(path, body, operationHeaders);
    } on ApiException catch (error) {
      if (error.statusCode != 0) rethrow;
      await storage.enqueue(
        method: 'POST',
        path: path,
        body: body,
        headers: operationHeaders,
        operationId: operationId,
      );
      pendingSync.value = (await storage.queue()).length;
      rejectedSync.value = (await storage.rejectedQueue()).length;
      return {'queued': true};
    }
  }

  Future<dynamic> putQueued(String path, [Object? body]) async {
    final operationId = storage.newOperationId();
    try {
      return await _send(
        'PUT',
        path,
        body: body,
        headers: {'idempotency-key': operationId},
      );
    } on ApiException catch (error) {
      if (error.statusCode != 0) rethrow;
      await storage.enqueue(
        method: 'PUT',
        path: path,
        body: body,
        headers: {'idempotency-key': operationId},
        operationId: operationId,
      );
      pendingSync.value = (await storage.queue()).length;
      return {'queued': true};
    }
  }

  Future<int> flushQueue() async {
    if (_flushing || session == null) return (await storage.queue()).length;
    _flushing = true;
    try {
      for (final item in await storage.queue()) {
        try {
          await _send(
            item.method,
            item.path,
            body: item.body,
            headers: item.headers,
          );
          await storage.removeQueued(item.id);
          if (item.path == '/v1/courier/location') {
            final syncedAt = DateTime.now();
            lastLocationSync.value = syncedAt;
            await storage.saveLastLocationSync(syncedAt);
          }
        } on ApiException catch (error) {
          final permanent =
              error.statusCode >= 400 &&
              error.statusCode < 500 &&
              error.statusCode != 408 &&
              error.statusCode != 429;
          if (permanent) {
            await storage.rejectQueued(item.id, error.message);
            continue;
          }
          break;
        } catch (_) {
          break;
        }
      }
      final queue = await storage.queue();
      pendingSync.value = queue.length;
      rejectedSync.value = (await storage.rejectedQueue()).length;
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
      final request = await _http.openUrl(
        method,
        Uri.parse('$apiBaseUrl$path'),
      );
      request.headers.contentType = ContentType.json;
      if (headers != null) headers.forEach(request.headers.set);
      if (auth && session != null) {
        request.headers.set('authorization', 'Bearer ${session!.accessToken}');
      }
      if (body != null) request.write(jsonEncode(body));
      final response = await request.close();
      final text = await utf8.decoder.bind(response).join();
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
        connected.value = true;
        if (method == 'GET' &&
            path.startsWith('/v1/') &&
            !path.contains('/auth/')) {
          await storage.cacheResponse(path, decoded);
        }
        return decoded;
      }
      if (response.statusCode == 401 && auth && retry) {
        if (await _refresh()) {
          return await _send(
            method,
            path,
            body: body,
            headers: headers,
            retry: false,
          );
        }
        session = null;
        await storage.clearSession();
      }
      throw ApiException(
        _message(decoded, response.statusCode),
        response.statusCode,
      );
    } on SocketException catch (error) {
      return _networkFailure(method, path, error.message);
    } on HttpException catch (error) {
      return _networkFailure(method, path, error.message);
    } on TimeoutException {
      return _networkFailure(method, path, 'The request timed out.');
    }
  }

  Future<dynamic> _networkFailure(String method, String path, String message) async {
    offline = true;
    connected.value = false;
    if (method == 'GET') {
      final cached = await storage.readCachedResponse(path);
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
    if (body is Map) {
      if (body['error'] is Map && body['error']['message'] != null) {
        return body['error']['message'].toString();
      }
      if (body['message'] != null) {
        final message = body['message'];
        if (message is List) return message.join(', ');
        return message.toString();
      }
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

  Future<Session> verifyOtp(
    String phone,
    String code,
    String challengeId,
  ) async {
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
    await storage.clearSensitiveData();
    pendingSync.value = 0;
    rejectedSync.value = 0;
    lastLocationSync.value = null;
    if (current == null) return;
    try {
      await _send(
        'POST',
        '/v1/auth/logout',
        body: {'refreshToken': current.refreshToken},
        auth: false,
        retry: false,
      );
    } catch (_) {
      // Local credentials are discarded even when the server session expired.
    }
  }

  void dispose() {
    unawaited(storage.clearSensitiveData());
    pendingSync.value = 0;
    rejectedSync.value = 0;
    lastLocationSync.value = null;
    _http.close(force: true);
  }
}

Map<String, dynamic> asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

List<Map<String, dynamic>> asList(dynamic value) {
  if (value is! List) return <Map<String, dynamic>>[];
  return value.map(asMap).toList();
}

String money(num? minor, [String? currency]) {
  final value = (minor ?? 0) / 100;
  final parts = value.toStringAsFixed(2).split('.');
  final whole = parts[0].replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
    (match) => '${match[1]},',
  );
  return '$whole.${parts[1]} ${currency ?? 'ETB'}';
}

String label(String? value) {
  if (value == null || value.isEmpty) return '—';
  return value
      .toLowerCase()
      .split('_')
      .map(
        (word) =>
            word.isEmpty ? word : word[0].toUpperCase() + word.substring(1),
      )
      .join(' ');
}

String shortDate(String? value) {
  if (value == null) return '—';
  final date = DateTime.tryParse(value)?.toLocal();
  if (date == null) return '—';
  return '${date.day}/${date.month}/${date.year} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

class CourierGate extends StatefulWidget {
  const CourierGate({
    super.key,
    required this.client,
    required this.push,
    required this.onLocaleChanged,
  });

  final ApiClient client;
  final PushService push;
  final ValueChanged<String> onLocaleChanged;

  @override
  State<CourierGate> createState() => _CourierGateState();
}

class _CourierGateState extends State<CourierGate> {
  @override
  void initState() {
    super.initState();
    if (widget.client.session != null) {
      unawaited(widget.push.registerForSession());
      unawaited(widget.client.flushQueue());
    }
  }

  void _signedIn() {
    setState(() {});
    unawaited(widget.push.registerForSession());
    unawaited(widget.client.flushQueue());
  }

  Future<void> _signedOut() async {
    await widget.push.unregister();
    await widget.client.signOut();
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    if (widget.client.session == null) {
      return LoginScreen(client: widget.client, onSignedIn: _signedIn);
    }
    return CourierHome(
      client: widget.client,
      onSignedOut: _signedOut,
      onLocaleChanged: widget.onLocaleChanged,
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.client,
    required this.onSignedIn,
  });

  final ApiClient client;
  final VoidCallback onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final phoneController = TextEditingController();
  final codeController = TextEditingController();
  String? challengeId;
  bool busy = false;
  String? error;

  @override
  void dispose() {
    phoneController.dispose();
    codeController.dispose();
    super.dispose();
  }

  Future<void> sendCode() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final challenge = await widget.client.requestOtp(
        phoneController.text.trim(),
      );
      setState(() => challengeId = challenge['challengeId'] as String?);
    } catch (cause) {
      setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> verify() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.client.verifyOtp(
        phoneController.text.trim(),
        codeController.text.trim(),
        challengeId!,
      );
      widget.onSignedIn();
    } catch (cause) {
      setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 60, 24, 32),
          children: [
            Container(
              width: 54,
              height: 54,
              decoration: const BoxDecoration(
                color: Color(0xFF2F6B4F),
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(27),
                  topRight: Radius.circular(27),
                  bottomLeft: Radius.circular(27),
                  bottomRight: Radius.circular(6),
                ),
              ),
              child: const Icon(
                Icons.delivery_dining,
                color: Colors.white,
                size: 30,
              ),
            ),
            const SizedBox(height: 28),
            Text(
              l10n.courierSignInTitle,
              style: theme.textTheme.displaySmall?.copyWith(
                fontWeight: FontWeight.w800,
                letterSpacing: -1.6,
                height: 1.02,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              challengeId == null
                  ? l10n.courierSignInSubtitle
                  : l10n.enterCodeTo(phoneController.text.trim()),
              style: theme.textTheme.bodyLarge?.copyWith(
                color: const Color(0xFF6B7468),
                height: 1.5,
              ),
            ),
            const SizedBox(height: 32),
            if (challengeId == null) ...[
              TextField(
                controller: phoneController,
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(
                  labelText: l10n.phoneNumber,
                  hintText: '+2519XXXXXXXX',
                ),
                onSubmitted: (_) => sendCode(),
              ),
              if (error != null) ...[
                const SizedBox(height: 12),
                ErrorBanner(message: error!),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: busy ? null : sendCode,
                child: Text(busy ? l10n.sending : l10n.sendSignInCode),
              ),
            ] else ...[
              TextField(
                controller: codeController,
                keyboardType: TextInputType.number,
                autofocus: true,
                decoration: InputDecoration(
                  labelText: l10n.oneTimeCode,
                  hintText: '123456',
                ),
                onSubmitted: (_) => verify(),
              ),
              if (error != null) ...[
                const SizedBox(height: 12),
                ErrorBanner(message: error!),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: busy ? null : verify,
                child: Text(busy ? l10n.verifying : l10n.continueLabel),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: busy
                    ? null
                    : () => setState(() {
                        challengeId = null;
                        codeController.clear();
                        error = null;
                      }),
                child: Text(l10n.differentNumber),
              ),
            ],
            const SizedBox(height: 40),
            Text(
              '${l10n.courierAccessNote} API: $apiBaseUrl',
              style: theme.textTheme.bodySmall?.copyWith(
                color: const Color(0xFF6B7468),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFBEAE7),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFEFC7C1)),
      ),
      child: Text(
        message,
        style: const TextStyle(color: Color(0xFFA63A32), fontSize: 13),
      ),
    );
  }
}

class CourierHome extends StatefulWidget {
  const CourierHome({
    super.key,
    required this.client,
    required this.onSignedOut,
    required this.onLocaleChanged,
  });

  final ApiClient client;
  final Future<void> Function() onSignedOut;
  final ValueChanged<String> onLocaleChanged;

  @override
  State<CourierHome> createState() => _CourierHomeState();
}

class _CourierHomeState extends State<CourierHome> with WidgetsBindingObserver {
  int index = 0;
  bool initializing = true;
  bool needsOnboarding = false;
  Map<String, dynamic>? profile;
  Map<String, dynamic>? activeDelivery;
  List<Map<String, dynamic>> offers = [];
  List<Map<String, dynamic>> pendingReturns = [];
  List<Map<String, dynamic>> disputes = [];
  Map<String, dynamic>? earnings;
  bool busy = false;
  String? error;
  bool _sendingLocation = false;
  bool _locationConsent = false;
  bool? _trackingForDelivery;
  int _lastPendingSync = 0;
  String _todayFilter = 'all';
  String _earningsFilter = 'all';
  final LocationService _location = LocationService();
  Timer? _offerCountdown;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.client.pendingSync.addListener(_onPendingSync);
    widget.client.rejectedSync.addListener(_onPendingSync);
    widget.client.connected.addListener(_onPendingSync);
    widget.client.lastLocationSync.addListener(_onPendingSync);
    _lastPendingSync = widget.client.pendingSync.value;
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    _locationConsent = await widget.client.storage.hasLocationConsent();
    await _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.client.pendingSync.removeListener(_onPendingSync);
    widget.client.rejectedSync.removeListener(_onPendingSync);
    widget.client.connected.removeListener(_onPendingSync);
    widget.client.lastLocationSync.removeListener(_onPendingSync);
    _offerCountdown?.cancel();
    _offerCountdown = null;
    unawaited(_location.stop());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(widget.client.flushQueue());
      if (_locationConsent) {
        unawaited(_location.stop().then((_) {
          _trackingForDelivery = null;
          _syncLocationHeartbeat();
        }));
      }
    }
  }

  void _onPendingSync() {
    final pending = widget.client.pendingSync.value;
    final completed = _lastPendingSync > 0 && pending == 0;
    _lastPendingSync = pending;
    if (mounted) setState(() {});
    if (completed && mounted && widget.client.session != null && profile != null) {
      unawaited(_refreshData());
    }
  }

  Future<void> _load() async {
    setState(() {
      initializing = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.get('/v1/courier/me'));
      final active = asMap(
        await widget.client.get('/v1/courier/deliveries/active'),
      );
      final offerResult = asMap(await widget.client.get('/v1/courier/offers'));
      final earningsResult = asMap(
        await widget.client.get('/v1/courier/earnings'),
      );
      final returnResult = asMap(
        await widget.client.get('/v1/courier/returns'),
      );
      Map<String, dynamic> disputeResult = <String, dynamic>{};
      try {
        disputeResult = asMap(await widget.client.get('/v1/courier/earnings/disputes'));
      } catch (_) {
        // Older backends may not expose earnings disputes yet.
      }
      if (!mounted) return;
      setState(() {
        profile = result;
        activeDelivery = active['delivery'] == null
            ? null
            : asMap(active['delivery']);
        offers = asList(offerResult['items']);
        pendingReturns = asList(returnResult['items']);
        disputes = asList(disputeResult['items']);
        earnings = earningsResult;
        needsOnboarding = false;
      });
      _startOfferCountdown();
      _syncLocationHeartbeat();
    } on ApiException catch (cause) {
      if (cause.statusCode == 403 || cause.statusCode == 404) {
        if (mounted) {
          setState(() {
            needsOnboarding = true;
            error = null;
          });
        }
      } else if (mounted) {
        setState(() => error = cause.message);
      }
    } catch (cause) {
      if (mounted) {
        final isNotFound = cause.toString().contains('404') || cause.toString().contains('403');
        setState(() {
          if (isNotFound) {
            needsOnboarding = true;
            error = null;
          } else {
            error = cause.toString();
          }
        });
      }
    } finally {
      if (mounted) setState(() => initializing = false);
    }
  }

  Future<void> _refreshData() async {
    if (needsOnboarding || profile == null) return;
    try {
      final active = asMap(
        await widget.client.get('/v1/courier/deliveries/active'),
      );
      final offerResult = asMap(await widget.client.get('/v1/courier/offers'));
      final earningsResult = asMap(
        await widget.client.get('/v1/courier/earnings'),
      );
      final returnResult = asMap(
        await widget.client.get('/v1/courier/returns'),
      );
      Map<String, dynamic> disputeResult = <String, dynamic>{};
      try {
        disputeResult = asMap(await widget.client.get('/v1/courier/earnings/disputes'));
      } catch (_) {
        // Older backends may not expose earnings disputes yet.
      }
      if (!mounted) return;
      setState(() {
        activeDelivery = active['delivery'] == null
            ? null
            : asMap(active['delivery']);
        offers = asList(offerResult['items']);
        pendingReturns = asList(returnResult['items']);
        disputes = asList(disputeResult['items']);
        earnings = earningsResult;
      });
      _startOfferCountdown();
      _syncLocationHeartbeat();
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    }
  }

  DateTime? _offerExpiresAt(Map<String, dynamic> offer) {
    final raw = offer['expiresAt']?.toString();
    if (raw == null) return null;
    return DateTime.tryParse(raw);
  }

  Duration _offerRemaining(Map<String, dynamic> offer) {
    final expiresAt = _offerExpiresAt(offer);
    if (expiresAt == null) return const Duration(seconds: 0);
    final remaining = expiresAt.difference(DateTime.now());
    return remaining.isNegative ? const Duration(seconds: 0) : remaining;
  }

  bool _offerExpired(Map<String, dynamic> offer) =>
      _offerRemaining(offer) <= Duration.zero;

  bool _canAcceptOffer(Map<String, dynamic> offer) {
    if (busy) return false;
    if (_offerExpired(offer)) return false;
    final availability = asMap(profile?['availability']);
    final online = availability['isOnline'] == true;
    final acceptingOffers = availability['acceptingOffers'] == true;
    final approved = (profile?['status']?.toString() ?? '') == 'approved';
    if (!online || !acceptingOffers || !approved) return false;
    if (activeDelivery != null) return false;
    return true;
  }

  void _startOfferCountdown() {
    _stopOfferCountdown();
    if (offers.isEmpty) return;
    _offerCountdown = Timer.periodic(const Duration(seconds: 1), (_) {
      unawaited(_tickOfferCountdown());
    });
  }

  void _stopOfferCountdown() {
    _offerCountdown?.cancel();
    _offerCountdown = null;
  }

  Future<void> _tickOfferCountdown() async {
    if (!mounted) return;
    for (final offer in offers) {
      if (_offerExpired(offer)) {
        // Offers past their expiry are dropped by the backend on the next sync.
        await _refreshData();
        return;
      }
    }
    if (mounted) setState(() {});
  }

  Future<void> _setAvailability({bool? online, bool? accepting}) async {
    final availability = asMap(profile?['availability']);
    final isOnline = online ?? availability['isOnline'] == true;
    if (isOnline && availability['isOnline'] != true) {
      if (!await _confirmLocationSharing()) return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final position = isOnline ? await _location.currentPosition() : null;
      final result = asMap(
        await widget.client.put('/v1/courier/availability', {
          'isOnline': isOnline,
          'acceptingOffers':
              accepting ?? availability['acceptingOffers'] ?? true,
          if (position != null) 'latitude': position.latitude,
          if (position != null) 'longitude': position.longitude,
        }),
      );
      if (!mounted) return;
      if (isOnline) {
        _locationConsent = true;
        await widget.client.storage.saveLocationConsent(true);
      }
      setState(() {
        profile = {
          ...?profile,
          'availability': {...availability, ...result},
        };
      });
      _syncLocationHeartbeat();
      if (!isOnline) {
        _stopOfferCountdown();
      } else {
        _startOfferCountdown();
      }
      await _refreshData();
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<bool> _confirmLocationSharing() async {
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Location sharing while on duty'),
        content: const Text(
          'When you go online, the app sends your location to support dispatch and active delivery progress. Location updates may continue in the background while you are on duty; your device will show its location indicator or foreground notification. During an active delivery, limited location samples are encrypted on this device if the network is unavailable and are removed after the server accepts them. Tracking stops when you go offline.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Not now'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    return accepted == true;
  }

  Future<void> _enableLocationSharing() async {
    if (!await _confirmLocationSharing()) return;
    try {
      await _location.currentPosition();
      _locationConsent = true;
      await widget.client.storage.saveLocationConsent(true);
      _syncLocationHeartbeat();
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    }
  }

  Future<void> _openBackgroundLocationSettings() async {
    final openSettings = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Allow background location'),
        content: const Text(
          'To keep delivery progress current while the app is in the background, change this app’s location access to “Allow all the time” in system settings. Foreground tracking remains available if you do not enable it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Open settings'),
          ),
        ],
      ),
    );
    if (openSettings == true) await _location.openAppSettings();
  }

  Future<void> _showRejectedOperations() async {
    final rejected = await widget.client.storage.rejectedQueue();
    if (!mounted || rejected.isEmpty) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Updates needing attention'),
        content: SizedBox(
          width: 440,
          child: ListView.separated(
            shrinkWrap: true,
            itemCount: rejected.length,
            separatorBuilder: (_, _) => const Divider(height: 20),
            itemBuilder: (context, index) {
              final item = rejected[index];
              final segments = item.path.split('/');
              final action = segments.isNotEmpty ? segments.last : item.path;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label(action), style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(item.rejection ?? 'The server did not accept this update.'),
                  const SizedBox(height: 4),
                  Text(shortDate(item.createdAt.toIso8601String()), style: Theme.of(context).textTheme.bodySmall),
                ],
              );
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () async {
              await widget.client.storage.clearRejected();
              widget.client.rejectedSync.value = 0;
              if (dialogContext.mounted) Navigator.pop(dialogContext);
            },
            child: const Text('Dismiss reviewed updates'),
          ),
        ],
      ),
    );
  }

  void _syncLocationHeartbeat() {
    final online = asMap(profile?['availability'])['isOnline'] == true;
    if ((!online && activeDelivery == null) || !_locationConsent) {
      unawaited(_location.stop().then((_) {
        if (mounted) setState(() {});
      }));
      _trackingForDelivery = null;
      return;
    }
    unawaited(_startLocationTracking());
  }

  Future<void> _startLocationTracking() async {
    final active = activeDelivery != null;
    if (_location.isRunning && _trackingForDelivery == active) return;
    if (_location.isRunning) await _location.stop();
    final l10n = mounted ? AppLocalizations.of(context) : null;
    final notificationTitle = l10n?.courierLocationTitle ?? 'Courier location';
    final notificationText = l10n?.courierLocationText ?? 'Sharing location';
    try {
      await _location.start(
        onPosition: (position) => unawaited(_reportPosition(position)),
        onError: (cause) {
          if (mounted) setState(() => error = cause.toString());
        },
        notificationTitle: notificationTitle,
        notificationText: notificationText,
        activeDelivery: active,
      );
      _trackingForDelivery = active;
      if (mounted) setState(() {});
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    }
  }

  Future<bool> _reportPosition(Position position) async {
    final online = asMap(profile?['availability'])['isOnline'] == true;
    if (_sendingLocation ||
        !_locationConsent ||
        widget.client.session == null ||
        (!online && activeDelivery == null)) {
      return false;
    }
    _sendingLocation = true;
    final operationId = widget.client.storage.newOperationId();
    final headers = {'idempotency-key': operationId};
    final body = {
      'latitude': position.latitude,
      'longitude': position.longitude,
      'accuracyMeters': position.accuracy,
      'headingDegrees': position.heading,
      'speedMps': position.speed,
    };
    try {
      final result = activeDelivery != null
          ? await widget.client.postQueued(
              '/v1/courier/location',
              body,
              headers,
            )
          : await widget.client.post(
              '/v1/courier/location',
              body,
              headers,
            );
      if (result is Map && result['queued'] == true) return false;
      final syncedAt = DateTime.now();
      widget.client.lastLocationSync.value = syncedAt;
      await widget.client.storage.saveLastLocationSync(syncedAt);
      return true;
    } catch (cause) {
      if (cause is ApiException &&
          cause.statusCode >= 400 &&
          widget.client.session != null) {
        try {
          await widget.client.storage.recordRejected(
            id: operationId,
            method: 'POST',
            path: '/v1/courier/location',
            body: body,
            headers: headers,
            reason: cause.message,
          );
          widget.client.rejectedSync.value =
              (await widget.client.storage.rejectedQueue()).length;
        } catch (_) {
          if (mounted) setState(() => error = cause.message);
        }
      }
      return false;
    } finally {
      _sendingLocation = false;
    }
  }

  Future<void> _sendLocation() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final position = await _location.currentPosition();
      if (!await _reportPosition(position)) {
        throw ApiException('Location is waiting for network sync.', 0);
      }
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.liveLocationSent)));
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _acceptOffer(Map<String, dynamic> offer) async {
    setState(() => busy = true);
    try {
      await widget.client.post('/v1/courier/offers/${offer['offerId']}/accept');
      await _refreshData();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '${offer['orderNumber']} accepted. Head to the merchant.',
            ),
          ),
        );
      }
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _rejectOffer(Map<String, dynamic> offer) async {
    setState(() => busy = true);
    try {
      await widget.client.post(
        '/v1/courier/offers/${offer['offerId']}/reject',
        {'reason': 'Not available'},
      );
      await _refreshData();
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _openDelivery(Map<String, dynamic> delivery) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => DeliveryExecutionScreen(
          client: widget.client,
          orderId: delivery['orderId'].toString(),
          initial: delivery,
        ),
      ),
    );
    if (mounted) await _refreshData();
  }

  Future<void> _signOut() async {
    await _location.stop();
    await widget.onSignedOut();
  }

  void _onRegistered(Map<String, dynamic> registered) {
    setState(() {
      profile = registered;
      needsOnboarding = false;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (initializing) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (needsOnboarding) {
      return OnboardingScreen(
        client: widget.client,
        onRegistered: _onRegistered,
        onSignOut: widget.onSignedOut,
      );
    }
    final availability = asMap(profile?['availability']);
    final online = availability['isOnline'] == true;
    final roles = (widget.client.session?.user['roles'] as List? ?? const [])
        .map((role) => label(role.toString()))
        .join(', ');
    return Scaffold(
      appBar: AppBar(
        title: Text([l10n.today, l10n.earnings, l10n.profile][index]),
        actions: [
          if (widget.client.pendingSync.value > 0)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Badge(
                label: Text('${widget.client.pendingSync.value}'),
                child: IconButton(
                  tooltip: l10n.pendingSync,
                  onPressed: () => unawaited(widget.client.flushQueue()),
                  icon: const Icon(Icons.cloud_upload_outlined),
                ),
              ),
            ),
          IconButton(
            tooltip: l10n.refresh,
            onPressed: busy ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: IndexedStack(
        index: index,
        children: [
          _todayView(online, availability),
          _earningsView(),
          _profileView(roles),
        ],
      ),
      bottomNavigationBar: FloatingBarDock(
        primary: FloatingNavigationBar(
          semanticsLabel: 'Courier navigation',
          selectedIndex: index,
          onSelected: (value) => setState(() => index = value),
          items: [
            FloatingBarItem(
              icon: Icons.two_wheeler_outlined,
              selectedIcon: Icons.two_wheeler,
              label: l10n.today,
              badge: activeDelivery == null ? null : '1',
            ),
            FloatingBarItem(
              icon: Icons.payments_outlined,
              selectedIcon: Icons.payments,
              label: l10n.earnings,
            ),
            FloatingBarItem(
              icon: Icons.person_outline,
              selectedIcon: Icons.person,
              label: l10n.profile,
            ),
          ],
        ),
      ),
    );
  }

  Widget _todayFilterBar() {
    const values = ['all', 'status', 'active', 'offers'];
    final selected = values.indexOf(_todayFilter);
    return FloatingCategoryBar(
      semanticsLabel: 'Today view filters',
      selectedIndex: selected < 0 ? 0 : selected,
      minItemWidth: 86,
      onSelected: (value) => setState(() => _todayFilter = values[value]),
      items: [
        const FloatingBarItem(icon: Icons.dashboard_outlined, label: 'All'),
        const FloatingBarItem(icon: Icons.toggle_on_outlined, label: 'Status'),
        FloatingBarItem(
          icon: Icons.local_shipping_outlined,
          label: 'Active',
          badge: activeDelivery == null ? null : '1',
        ),
        FloatingBarItem(
          icon: Icons.notifications_active_outlined,
          label: 'Offers',
          badge: offers.isEmpty ? null : '${offers.length}',
        ),
      ],
    );
  }

  Widget _earningsFilterBar() {
    const values = ['all', 'summary', 'deliveries', 'payouts'];
    final selected = values.indexOf(_earningsFilter);
    final data = earnings ?? <String, dynamic>{};
    final payouts = asList(data['payouts']);
    return FloatingCategoryBar(
      semanticsLabel: 'Earnings view filters',
      selectedIndex: selected < 0 ? 0 : selected,
      minItemWidth: 86,
      onSelected: (value) => setState(() => _earningsFilter = values[value]),
      items: [
        const FloatingBarItem(
          icon: Icons.pie_chart_outline_rounded,
          label: 'All',
        ),
        const FloatingBarItem(icon: Icons.summarize_outlined, label: 'Summary'),
        FloatingBarItem(
          icon: Icons.receipt_long_outlined,
          label: 'Deliveries',
          badge: (data['recentDeliveries'] as List? ?? const []).isEmpty
              ? null
              : '${(data['recentDeliveries'] as List).length}',
        ),
        FloatingBarItem(
          icon: Icons.account_balance_wallet_outlined,
          label: 'Payouts',
          badge: payouts.isEmpty ? null : '${payouts.length}',
        ),
      ],
    );
  }

  Widget _todayView(bool online, Map<String, dynamic> availability) {
    final theme = Theme.of(context);
    final status = profile?['status']?.toString() ?? 'pending';
    final approved = status == 'approved';
    final showStatus = _todayFilter == 'all' || _todayFilter == 'status';
    final showActive = _todayFilter == 'all' || _todayFilter == 'active';
    final showOffers = _todayFilter == 'all' || _todayFilter == 'offers';
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: _todayFilterBar(),
        ),
        _syncStatusBar(online),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
              children: [
                if (error != null) ...[
                  ErrorBanner(message: error!),
                  const SizedBox(height: 12),
                ],
                if (showStatus && !approved)
                  Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF4EDDA),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Account ${label(status)}',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          status == 'pending'
                              ? 'Operations are reviewing your documents. You can go online after approval.'
                              : profile?['rejectionReason']?.toString() ?? 'Contact support to restore your courier account.',
                          style: const TextStyle(fontSize: 13, height: 1.4),
                        ),
                      ],
                    ),
                  ),
                if (showStatus)
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E2A24),
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'YOU ARE',
                                    style: TextStyle(
                                      color: Color(0xFF98A59A),
                                      fontSize: 11,
                                      letterSpacing: 1.6,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    online ? 'Online' : 'Offline',
                                    style: theme.textTheme.headlineMedium
                                        ?.copyWith(
                                          color: const Color(0xFFEEF0E6),
                                          fontWeight: FontWeight.w800,
                                          letterSpacing: -1,
                                        ),
                                  ),
                                ],
                              ),
                            ),
                            Switch(
                              value: online,
                              onChanged: approved && !busy
                                  ? (value) => _setAvailability(
                                      online: value,
                                      accepting: value,
                                    )
                                  : null,
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        const Divider(color: Color(0xFF38453D), height: 1),
                        SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          title: const Text(
                            'Accept new offers',
                            style: TextStyle(color: Color(0xFFEEF0E6)),
                          ),
                          subtitle: const Text(
                            'Pause this while you are on a delivery.',
                            style: TextStyle(
                              color: Color(0xFF98A59A),
                              fontSize: 12,
                            ),
                          ),
                          value: availability['acceptingOffers'] == true,
                          onChanged: online && approved && !busy
                              ? (value) => _setAvailability(accepting: value)
                              : null,
                          activeThumbColor: const Color(0xFF88C9A3),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: busy ||
                                  !_locationConsent ||
                                  (!online && activeDelivery == null)
                              ? null
                              : _sendLocation,
                          icon: const Icon(Icons.my_location),
                          label: const Text('Send location heartbeat'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFFEEF0E6),
                            side: const BorderSide(color: Color(0xFF536259)),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 12),
                if (showStatus)
                  Row(
                    children: [
                      Expanded(
                        child: _statCard(
                          'Rating',
                          (profile?['ratingAverage'] as num? ?? 0)
                              .toStringAsFixed(1),
                          Icons.star_outline,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _statCard(
                          'Deliveries',
                          '${profile?['completedDeliveries'] ?? 0}',
                          Icons.check_circle_outline,
                        ),
                      ),
                    ],
                  ),
                if (showStatus)
                  Row(
                    children: [
                      Expanded(
                        child: _statCard(
                          'Capacity',
                          '${profile?['capacityUnits'] ?? 1} units',
                          Icons.inventory_2_outlined,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _statCard(
                          'Workload',
                          activeDelivery == null ? 'Idle' : 'On delivery',
                          activeDelivery == null
                              ? Icons.hourglass_empty_outlined
                              : Icons.local_shipping_outlined,
                        ),
                      ),
                    ],
                  ),
                const SizedBox(height: 20),
                if (showActive) ...[
                  Text(
                    'Active delivery',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 10),
                  if (activeDelivery == null)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Center(
                        child: Text(
                          'No active delivery right now.',
                          style: TextStyle(color: Color(0xFF6B7468)),
                        ),
                      ),
                    )
                  else
                    _activeDeliveryCard(activeDelivery!),
                  const SizedBox(height: 20),
                ],
                if (pendingReturns.isNotEmpty) ...[
                  Text(
                    'Returns to merchant',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 10),
                  ...pendingReturns.map(_returnCard),
                  const SizedBox(height: 20),
                ],
                if (showOffers) ...[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Offers for you',
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (busy)
                        const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  if (offers.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 32),
                      child: Center(
                        child: Text(
                          'No offers right now. Stay online near busy merchants.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Color(0xFF6B7468)),
                        ),
                      ),
                    ),
                  ...offers.map(_offerCard),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _syncStatusBar(bool onDuty) {
    final connected = widget.client.connected.value;
    final lastSync = widget.client.lastLocationSync.value;
    final pending = widget.client.pendingSync.value;
    final rejected = widget.client.rejectedSync.value;
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 10, 20, 2),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF7),
        border: Border.all(color: const Color(0xFFD9D5C7)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                connected ? Icons.wifi : Icons.wifi_off,
                size: 18,
                color: connected ? const Color(0xFF28744C) : const Color(0xFFA63A32),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  connected ? 'Network connected' : 'Offline; saved data available',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
              if (pending > 0)
                TextButton.icon(
                  onPressed: () => unawaited(widget.client.flushQueue()),
                  icon: const Icon(Icons.sync, size: 16),
                  label: Text('$pending pending'),
                ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 26),
            child: Text(
              'Last location sync: ${lastSync == null ? 'Never' : shortDate(lastSync.toIso8601String())}  ·  ${(onDuty || activeDelivery != null) && _locationConsent ? (_location.backgroundEnabled ? 'Background tracking active' : 'Foreground tracking only') : 'Location sharing off'}',
              style: const TextStyle(color: Color(0xFF667066), fontSize: 11),
            ),
          ),
          if ((onDuty || activeDelivery != null) && !_locationConsent)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: _enableLocationSharing,
                child: const Text('Enable location updates'),
              ),
            ),
          if ((onDuty || activeDelivery != null) && _locationConsent && !_location.backgroundEnabled)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _openBackgroundLocationSettings,
                icon: const Icon(Icons.location_searching, size: 17),
                label: const Text('Allow background access'),
              ),
            ),
          if (rejected > 0)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _showRejectedOperations,
                icon: const Icon(Icons.warning_amber_outlined, size: 17),
                label: Text('$rejected update${rejected == 1 ? '' : 's'} rejected; review'),
                style: TextButton.styleFrom(foregroundColor: const Color(0xFFA63A32)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _statCard(String title, String value, IconData icon) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFF2F6B4F)),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(0xFF6B7468),
                    fontSize: 12,
                  ),
                ),
                Text(
                  value,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 20,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _offerCard(Map<String, dynamic> offer) {
    final theme = Theme.of(context);
    final remaining = _offerRemaining(offer);
    final expired = remaining <= Duration.zero;
    final secondsLeft = remaining.inSeconds;
    final minutesLeft = (secondsLeft ~/ 60).toString().padLeft(2, '0');
    final seconds = (secondsLeft % 60).toString().padLeft(2, '0');
    final canAccept = _canAcceptOffer(offer);
    final compensationMinor = (offer['compensationMinor'] as num? ?? 0).toInt();
    final tipMinor = (offer['tipMinor'] as num? ?? 0).toInt();
    final deductionsMinor = (offer['deductionsMinor'] as num? ?? 0).toInt();
    final deliveryDistance = offer['deliveryDistanceMeters'] as num?;
    final estimatedMinutes = offer['estimatedMinutes'] as num?;
    final availability = asMap(profile?['availability']);
    final online = availability['isOnline'] == true;
    final acceptingOffers = availability['acceptingOffers'] == true;
    final approved = (profile?['status']?.toString() ?? '') == 'approved';
    String? eligibilityNote;
    if (busy) {
      eligibilityNote = 'Updating your delivery state.';
    } else if (expired) {
      eligibilityNote = 'This offer expired. Waiting for the next delivery.';
    } else if (activeDelivery != null) {
      eligibilityNote = 'Finish your current delivery before accepting another offer.';
    } else if (!online) {
      eligibilityNote = 'You are offline. Go online to receive and accept offers.';
    } else if (!acceptingOffers) {
      eligibilityNote = 'Offer intake is paused. Resume accepting offers to take this delivery.';
    } else if (!approved) {
      eligibilityNote = 'Your courier account is still awaiting operations approval.';
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      offer['orderNumber']?.toString() ?? 'Offer',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  Text(
                    money(
                      compensationMinor,
                      offer['currency']?.toString(),
                    ),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${offer['merchantName'] ?? 'Merchant'} · ${((offer['distanceToPickupMeters'] as num? ?? 0) / 1000).toStringAsFixed(1)} km away',
                style: const TextStyle(color: Color(0xFF6B7468), fontSize: 13),
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: expired
                      ? const Color(0xFFFFEBEE)
                      : secondsLeft <= 20
                          ? const Color(0xFFFFE0B2)
                          : const Color(0xFFE4F0E8),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  children: [
                    Icon(
                      expired
                          ? Icons.timer_off_outlined
                          : secondsLeft <= 20
                              ? Icons.timer_outlined
                              : Icons.hourglass_empty_outlined,
                      size: 14,
                      color: expired
                          ? const Color(0xFFB71C1C)
                          : secondsLeft <= 20
                              ? const Color(0xFFB26A00)
                              : const Color(0xFF2F6B4F),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      expired
                          ? 'Offer expired'
                          : 'Accepting in $minutesLeft:$seconds',
                      style: TextStyle(
                        color: expired
                            ? const Color(0xFFB71C1C)
                            : secondsLeft <= 20
                                ? const Color(0xFFB26A00)
                                : const Color(0xFF2F6B4F),
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              _stopRow(
                Icons.storefront,
                'Pickup',
                offer['merchantName']?.toString() ?? 'Merchant',
                offer['pickupAddress']?.toString(),
              ),
              const SizedBox(height: 8),
              _stopRow(
                Icons.location_on_outlined,
                'Deliver to',
                offer['customerName']?.toString() ?? 'Customer',
                offer['deliveryAddress']?.toString(),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.route_outlined, size: 16, color: Color(0xFF2F6B4F)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Pickup ${((offer['distanceToPickupMeters'] as num? ?? 0) / 1000).toStringAsFixed(1)} km away · Delivery ${deliveryDistance == null ? '—' : ((deliveryDistance / 1000).toStringAsFixed(1))} km away',
                      style: const TextStyle(fontSize: 13, color: Color(0xFF6B7468)),
                    ),
                  ),
                ],
              ),
              if (estimatedMinutes != null)
                Text(
                  'Estimated travel time about $estimatedMinutes minutes.',
                  style: const TextStyle(fontSize: 13, color: Color(0xFF6B7468)),
                ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF7F5EC),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.payments_outlined, size: 16, color: Color(0xFF2F6B4F)),
                        const SizedBox(width: 8),
                        const Text(
                          'Compensation',
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Expanded(child: Text('Total', style: TextStyle(fontSize: 13, color: Color(0xFF6B7468)))),
                        Text(money(compensationMinor, offer['currency']?.toString()), style: const TextStyle(fontWeight: FontWeight.w800)),
                      ],
                    ),
                    if (tipMinor > 0) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Expanded(child: Text('Tip', style: TextStyle(fontSize: 13, color: Color(0xFF6B7468)))),
                          Text(money(tipMinor, offer['currency']?.toString()), style: const TextStyle(fontWeight: FontWeight.w800)),
                        ],
                      ),
                    ],
                    if (deductionsMinor > 0) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Expanded(child: Text('Deductions', style: TextStyle(fontSize: 13, color: Color(0xFFB71C1C)))),
                          Text(money(deductionsMinor, offer['currency']?.toString()), style: TextStyle(fontWeight: FontWeight.w800, color: const Color(0xFFB71C1C))),
                        ],
                      ),
                    ],
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const Expanded(child: Text('Estimated payout', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700))),
                        Text(money(compensationMinor - (deductionsMinor > 0 ? deductionsMinor : 0), offer['currency']?.toString()), style: const TextStyle(fontWeight: FontWeight.w800)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Text(
                '${label(profile?['vehicleType']?.toString())} · capacity ${profile?['capacityUnits'] ?? 1} units',
                style: const TextStyle(fontSize: 12, color: Color(0xFF6B7468)),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: canAccept ? () => _acceptOffer(offer) : null,
                      child: const Text('Accept'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: (!busy && !expired) ? () => _rejectOffer(offer) : null,
                      child: const Text('Pass'),
                    ),
                  ),
                ],
              ),
              if (eligibilityNote != null) ...[
                const SizedBox(height: 10),
                Text(
                  eligibilityNote,
                  style: const TextStyle(color: Color(0xFFB26A00), fontSize: 12, height: 1.4),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _returnCard(Map<String, dynamic> delivery) {
    final failure = asMap(delivery['failure']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 6,
          ),
          leading: const Icon(
            Icons.assignment_return_outlined,
            color: Color(0xFFB26A00),
          ),
          title: Text(
            delivery['orderNumber']?.toString() ?? 'Return',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          subtitle: Text(
            '${delivery['merchantName'] ?? 'Merchant'} · ${failure['reasonLabel'] ?? 'Failed delivery'}',
          ),
          trailing: TextButton(
            onPressed: () => _openDelivery(delivery),
            child: const Text('Open'),
          ),
        ),
      ),
    );
  }

  Widget _activeDeliveryCard(Map<String, dynamic> delivery) {
    final theme = Theme.of(context);
    final assignmentStatus = delivery['assignmentStatus']?.toString();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    delivery['orderNumber']?.toString() ?? 'Delivery',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE4F0E8),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    label(assignmentStatus),
                    style: const TextStyle(
                      color: Color(0xFF2F6B4F),
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _stopRow(
              Icons.storefront,
              'Pickup',
              delivery['merchantName']?.toString() ?? '',
              delivery['pickupAddress']?.toString(),
            ),
            const SizedBox(height: 10),
            _stopRow(
              Icons.location_on_outlined,
              'Drop-off',
              delivery['customerName']?.toString() ?? 'Customer',
              delivery['deliveryAddress']?.toString(),
            ),
            if (delivery['customerPhone'] != null) ...[
              const SizedBox(height: 8),
              Text(
                'Customer phone: ${delivery['customerPhone']}',
                style: const TextStyle(fontSize: 13),
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Your earning',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: const Color(0xFF6B7468),
                    ),
                  ),
                ),
                Text(
                  money(
                    delivery['courierEarningMinor'] as num?,
                    delivery['currency']?.toString(),
                  ),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ],
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: busy ? null : () => _openDelivery(delivery),
              icon: const Icon(Icons.assignment_outlined),
              label: const Text('Open delivery'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stopRow(IconData icon, String title, String name, String? address) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 19, color: const Color(0xFF2F6B4F)),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 11,
                  color: Color(0xFF6B7468),
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(name, style: const TextStyle(fontWeight: FontWeight.w700)),
              if (address != null && address.isNotEmpty)
                Text(
                  address,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF6B7468),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _earningsView() {
    final theme = Theme.of(context);
    final data = earnings ?? <String, dynamic>{};
    final payouts = asList(data['payouts']);
    final recent = asList(data['recentDeliveries']);
    final showSummary =
        _earningsFilter == 'all' || _earningsFilter == 'summary';
    final showDeliveries =
        _earningsFilter == 'all' || _earningsFilter == 'deliveries';
    final showPayouts =
        _earningsFilter == 'all' || _earningsFilter == 'payouts';
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: _earningsFilterBar(),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _refreshData,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
              children: [
                if (error != null) ...[
                  ErrorBanner(message: error!),
                  const SizedBox(height: 12),
                ],
                if (showSummary) ...[
                  Container(
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E2A24),
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'LIFETIME EARNINGS',
                          style: TextStyle(
                            color: Color(0xFF98A59A),
                            fontSize: 11,
                            letterSpacing: 1.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          money(data['lifetimeEarningsMinor'] as num?),
                          style: const TextStyle(
                            color: Color(0xFFEEF0E6),
                            fontSize: 34,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -1,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: _darkStat(
                                'Gross earnings',
                                money(
                                  (data['lifetimeEarningsMinor'] as num? ?? 0) -
                                      (data['tipsMinor'] as num? ?? 0),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _darkStat(
                                'Tips',
                                money(data['tipsMinor'] as num?),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: _darkStat(
                                'Deductions',
                                money(_lifetimeDeductions(payouts)),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _darkStat(
                                'Net payable',
                                money(data['pendingPayoutMinor'] as num?),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: _darkStat(
                                'Settled earnings',
                                money(_settledEarnings(payouts)),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _darkStat(
                                'Pending payout',
                                money(data['pendingPayoutMinor'] as num?),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: _statCard(
                          'Completed',
                          '${data['completedDeliveries'] ?? 0}',
                          Icons.check_circle_outline,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _statCard(
                          'Payouts',
                          '${payouts.length}',
                          Icons.account_balance_wallet_outlined,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                ],
                if (showDeliveries) ...[
                  Text(
                    'Recent deliveries',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (recent.isEmpty)
                    const Text(
                      'Delivered orders will appear here.',
                      style: TextStyle(color: Color(0xFF6B7468)),
                    ),
                  ...recent.map(
                    (item) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        title: Text(item['orderNumber']?.toString() ?? ''),
                        subtitle: Text(
                          shortDate(item['deliveredAt']?.toString()),
                        ),
                        trailing: Text(
                          money(
                            (item['earningMinor'] as num? ?? 0) +
                                (item['tipMinor'] as num? ?? 0),
                            item['currency']?.toString(),
                          ),
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                ],
                if (showPayouts) ...[
                  Text(
                    'Payouts',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (payouts.isEmpty)
                    const Text(
                      'Payout statements will appear here.',
                      style: TextStyle(color: Color(0xFF6B7468)),
                    ),
                  ...payouts.map(
                    (payout) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        title: Text(
                          '${shortDate(payout['periodStart']?.toString())} – ${shortDate(payout['periodEnd']?.toString())}',
                        ),
                        subtitle: Text(
                          '${label(payout['status']?.toString())} · Gross ${money(payout['grossEarningsMinor'] as num?, payout['currency']?.toString())} · Deductions ${money(payout['deductionsMinor'] as num?, payout['currency']?.toString())}',
                        ),
                        trailing: Text(
                          money(
                            payout['netPayableMinor'] as num?,
                            payout['currency']?.toString(),
                          ),
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  num _lifetimeDeductions(List<Map<String, dynamic>> payouts) {
    var total = 0;
    for (final payout in payouts) {
      total += (payout['deductionsMinor'] as num? ?? 0).toInt();
    }
    return total;
  }

  num _settledEarnings(List<Map<String, dynamic>> payouts) {
    var total = 0;
    for (final payout in payouts) {
      if ((payout['status']?.toString() ?? '') == 'paid') {
        total += (payout['netPayableMinor'] as num? ?? 0).toInt();
      }
    }
    return total;
  }

  Widget _darkStat(String title, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(color: Color(0xFF98A59A), fontSize: 11),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(
            color: Color(0xFFEEF0E6),
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }

  Future<void> _uploadDocumentModal([String? initialType]) async {
    String selectedType = initialType ?? 'national_id';
    final docTypes = <String, String>{
      'national_id': 'National ID / Passport',
      'driving_license': 'Driving License',
      'vehicle_registration': 'Vehicle Logbook / Registration',
      'insurance': 'Vehicle Insurance Policy',
      'profile_photo': 'Courier Profile Photo',
    };

    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1600,
      imageQuality: 85,
    );
    if (picked == null || !mounted) return;
    final bytes = await picked.readAsBytes();
    if (bytes.length > 5 * 1024 * 1024) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Document must be 5 MB or smaller.')),
      );
      return;
    }
    final contentType = picked.mimeType ?? 'image/jpeg';
    if (!const {'image/jpeg', 'image/png', 'image/webp', 'application/pdf'}.contains(contentType)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Use a JPEG, PNG, WebP, or PDF document.')),
      );
      return;
    }

    if (!mounted) return;
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            return Padding(
              padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(sheetContext).viewInsets.bottom),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.verified_outlined, color: Color(0xFF2F6B4F)),
                      const SizedBox(width: 8),
                      Text('Upload verification document', style: Theme.of(sheetContext).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text('Selected: ${picked.name} (${(bytes.length / 1024).toStringAsFixed(0)} KB)', style: const TextStyle(color: Color(0xFF6B7468), fontSize: 13)),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    initialValue: selectedType,
                    decoration: const InputDecoration(labelText: 'Document type'),
                    items: docTypes.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
                    onChanged: (value) {
                      if (value != null) setSheetState(() => selectedType = value);
                    },
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () => Navigator.pop(sheetContext, true),
                      icon: const Icon(Icons.cloud_upload_outlined),
                      label: const Text('Submit for review'),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );

    if (confirmed != true || !mounted) return;
    setState(() => busy = true);
    try {
      await widget.client.post('/v1/courier/documents/upload', {
        'documentType': selectedType,
        'fileName': picked.name,
        'contentType': contentType,
        'dataBase64': base64Encode(bytes),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Document submitted successfully for Operations review.')),
      );
      _load();
    } catch (cause) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(cause.toString())),
      );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _profileView(String roles) {
    final theme = Theme.of(context);
    final documents = asList(profile?['documents']);
    final vehicles = asList(profile?['vehicles']);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
      children: [
        if (error != null) ...[
          ErrorBanner(message: error!),
          const SizedBox(height: 12),
        ],
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: const Color(0xFF1E2A24),
                      child: Text(
                        (profile?['fullName']?.toString() ?? 'C')
                            .characters
                            .first
                            .toUpperCase(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            profile?['fullName']?.toString() ?? 'Courier',
                            style: theme.textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            label(profile?['status']?.toString()),
                            style: const TextStyle(color: Color(0xFF6B7468)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _profileRow(
                  'Vehicle',
                  label(profile?['vehicleType']?.toString()),
                ),
                _profileRow(
                  'Plate',
                  profile?['vehiclePlate']?.toString() ?? '—',
                ),
                _profileRow(
                  'Capacity',
                  '${profile?['capacityUnits'] ?? 1} units',
                ),
                _profileRow(
                  'Phone',
                  widget.client.session?.user['phoneE164']?.toString() ?? '—',
                ),
                _profileRow('Roles', roles),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Verification Documents',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: busy ? null : () => _uploadDocumentModal(),
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Upload', style: TextStyle(fontSize: 12)),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        minimumSize: const Size(0, 32),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (documents.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      'No verification documents uploaded yet. Upload your National ID and Driving License to get approved.',
                      style: TextStyle(color: Color(0xFF6B7468), fontSize: 13),
                    ),
                  ),
                ...documents.map(
                  (document) {
                    final docStatus = document['status']?.toString() ?? 'pending';
                    final isRejected = docStatus == 'rejected';
                    final isApproved = docStatus == 'approved';
                    final docType = document['documentType']?.toString() ?? '';
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: isApproved
                            ? const Color(0xFFE8F5E9)
                            : isRejected
                                ? const Color(0xFFFFEBEE)
                                : const Color(0xFFF5F2E8),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isApproved
                              ? const Color(0xFFA5D6A7)
                              : isRejected
                                  ? const Color(0xFFEF9A9A)
                                  : const Color(0xFFD9D5C7),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                isApproved
                                    ? Icons.check_circle_outline
                                    : isRejected
                                        ? Icons.error_outline
                                        : Icons.hourglass_empty,
                                color: isApproved
                                    ? const Color(0xFF2E7D32)
                                    : isRejected
                                        ? const Color(0xFFC62828)
                                        : const Color(0xFFB26A00),
                                size: 18,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  label(docType),
                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: isApproved
                                      ? const Color(0xFFC8E6C9)
                                      : isRejected
                                          ? const Color(0xFFFFCDD2)
                                          : const Color(0xFFFFE0B2),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  label(docStatus).toUpperCase(),
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                    color: isApproved
                                        ? const Color(0xFF1B5E20)
                                        : isRejected
                                            ? const Color(0xFFB71C1C)
                                            : const Color(0xFFE65100),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (document['reviewNotes'] != null) ...[
                            const SizedBox(height: 6),
                            Text(
                              document['reviewNotes'].toString(),
                              style: TextStyle(
                                fontSize: 12,
                                color: isRejected ? const Color(0xFFC62828) : const Color(0xFF6B7468),
                              ),
                            ),
                          ],
                          if (isRejected) ...[
                            const SizedBox(height: 8),
                            OutlinedButton.icon(
                              onPressed: busy ? null : () => _uploadDocumentModal(docType),
                              icon: const Icon(Icons.refresh, size: 14),
                              label: const Text('Re-upload Document', style: TextStyle(fontSize: 11)),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: const Color(0xFFC62828),
                                side: const BorderSide(color: Color(0xFFEF9A9A)),
                                minimumSize: const Size(0, 30),
                                padding: const EdgeInsets.symmetric(horizontal: 10),
                              ),
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
                if (vehicles.isNotEmpty) ...[
                  const Divider(height: 26),
                  Text(
                    'Vehicles',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  ...vehicles.map(
                    (vehicle) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text(
                        '${label(vehicle['vehicleType']?.toString())} ${vehicle['plateNumber'] ?? ''}',
                      ),
                      subtitle: Text(vehicle['makeModel']?.toString() ?? ''),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Row(
              children: [
                const Icon(Icons.language),
                const SizedBox(width: 12),
                Expanded(child: Text(AppLocalizations.of(context).language)),
                DropdownButton<String>(
                  value: Localizations.localeOf(context).languageCode == 'am'
                      ? 'am'
                      : 'en',
                  underline: const SizedBox.shrink(),
                  items: [
                    DropdownMenuItem(
                      value: 'en',
                      child: Text(AppLocalizations.of(context).english),
                    ),
                    DropdownMenuItem(
                      value: 'am',
                      child: Text(AppLocalizations.of(context).amharic),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) widget.onLocaleChanged(value);
                  },
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Card(
          child: ListTile(
            leading: const Icon(Icons.logout),
            title: Text(AppLocalizations.of(context).signOut),
            onTap: _signOut,
          ),
        ),
        const SizedBox(height: 18),
        Text(
          '${AppLocalizations.of(context).connectedTo} $apiBaseUrl',
          textAlign: TextAlign.center,
          style: const TextStyle(color: Color(0xFF6B7468), fontSize: 12),
        ),
      ],
    );
  }

  Widget _profileRow(String title, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 92,
            child: Text(
              title,
              style: const TextStyle(color: Color(0xFF6B7468), fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({
    super.key,
    required this.client,
    required this.onRegistered,
    required this.onSignOut,
  });

  final ApiClient client;
  final ValueChanged<Map<String, dynamic>> onRegistered;
  final Future<void> Function() onSignOut;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final nameController = TextEditingController();
  final emailController = TextEditingController();
  final plateController = TextEditingController();
  final vehicleModelController = TextEditingController();
  final licenseController = TextEditingController();
  final capacityController = TextEditingController(text: '1');
  String vehicleType = 'motorcycle';
  bool busy = false;
  String? error;

  @override
  void dispose() {
    nameController.dispose();
    emailController.dispose();
    plateController.dispose();
    vehicleModelController.dispose();
    licenseController.dispose();
    capacityController.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    final name = nameController.text.trim();
    if (name.length < 2) {
      setState(() => error = 'Please enter your full name (at least 2 characters).');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = asMap(
        await widget.client.post('/v1/courier/register', {
          'fullName': name,
          if (emailController.text.trim().isNotEmpty)
            'email': emailController.text.trim(),
          'vehicleType': vehicleType,
          if (vehicleModelController.text.trim().isNotEmpty)
            'vehicleModel': vehicleModelController.text.trim(),
          if (plateController.text.trim().isNotEmpty)
            'vehiclePlate': plateController.text.trim(),
          if (licenseController.text.trim().isNotEmpty)
            'licenseNumber': licenseController.text.trim(),
          'capacityUnits': int.tryParse(capacityController.text.trim()) ?? 1,
        }),
      );
      widget.onRegistered(result);
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Become a courier'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            onPressed: () => widget.onSignOut(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
        children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: const Color(0xFF1E2A24),
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Earn on your schedule.',
                  style: theme.textTheme.headlineMedium?.copyWith(
                    color: const Color(0xFFEEF0E6),
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Tell us about your vehicle. Operations will review your profile before you can go online.',
                  style: TextStyle(color: Color(0xFFB7C1B8), height: 1.5),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          if (error != null) ...[
            ErrorBanner(message: error!),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: nameController,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Full name'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: emailController,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email (optional)'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: vehicleType,
            decoration: const InputDecoration(labelText: 'Vehicle'),
            items: const [
              DropdownMenuItem(value: 'walking', child: Text('Walking')),
              DropdownMenuItem(value: 'bicycle', child: Text('Bicycle')),
              DropdownMenuItem(value: 'motorcycle', child: Text('Motorcycle')),
              DropdownMenuItem(value: 'car', child: Text('Car')),
              DropdownMenuItem(value: 'van', child: Text('Van')),
            ],
            onChanged: (value) =>
                setState(() => vehicleType = value ?? 'motorcycle'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: vehicleModelController,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Vehicle model (optional)'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: plateController,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: 'Vehicle plate (optional)',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: licenseController,
            decoration: const InputDecoration(labelText: 'License number (optional)'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: capacityController,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Capacity units'),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: busy ? null : _register,
            child: Text(busy ? 'Creating profile…' : 'Create courier profile'),
          ),
          const SizedBox(height: 10),
          const Text(
            'After registration, upload identity and vehicle documents through operations before your first delivery.',
            style: TextStyle(
              color: Color(0xFF6B7468),
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}
