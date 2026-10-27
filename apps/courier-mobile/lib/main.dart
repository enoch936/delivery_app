import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import 'app_localizations.dart';
import 'app_storage.dart';
import 'location_service.dart';
import 'push_service.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000/api',
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
      scaffoldMessengerKey: scaffoldMessengerKey,
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
            minimumSize: const Size.fromHeight(50),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFF20261F),
            side: const BorderSide(color: Color(0xFFD9D5C7)),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
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
  Session({required this.accessToken, required this.refreshToken, required this.user});

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
      final request = await _http.openUrl(method, Uri.parse('$apiBaseUrl$path'));
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
    } on TimeoutException {
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
      .map((word) => word.isEmpty ? word : word[0].toUpperCase() + word.substring(1))
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
  const LoginScreen({super.key, required this.client, required this.onSignedIn});

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
      final challenge = await widget.client.requestOtp(phoneController.text.trim());
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
              child: const Icon(Icons.delivery_dining, color: Colors.white, size: 30),
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
                decoration: InputDecoration(labelText: l10n.phoneNumber, hintText: '+2519XXXXXXXX'),
                onSubmitted: (_) => sendCode(),
              ),
              if (error != null) ...[const SizedBox(height: 12), ErrorBanner(message: error!)],
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
                decoration: InputDecoration(labelText: l10n.oneTimeCode, hintText: '123456'),
                onSubmitted: (_) => verify(),
              ),
              if (error != null) ...[const SizedBox(height: 12), ErrorBanner(message: error!)],
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
              style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
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
      child: Text(message, style: const TextStyle(color: Color(0xFFA63A32), fontSize: 13)),
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

class _CourierHomeState extends State<CourierHome> {
  int index = 0;
  bool initializing = true;
  bool needsOnboarding = false;
  Map<String, dynamic>? profile;
  Map<String, dynamic>? activeDelivery;
  List<Map<String, dynamic>> offers = [];
  Map<String, dynamic>? earnings;
  bool busy = false;
  String? error;
  bool _sendingLocation = false;
  final LocationService _location = LocationService();

  @override
  void initState() {
    super.initState();
    widget.client.pendingSync.addListener(_onPendingSync);
    _load();
  }

  @override
  void dispose() {
    widget.client.pendingSync.removeListener(_onPendingSync);
    unawaited(_location.stop());
    super.dispose();
  }

  void _onPendingSync() {
    if (mounted) setState(() {});
  }

  Future<void> _load() async {
    setState(() {
      initializing = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.get('/v1/courier/me'));
      final active = asMap(await widget.client.get('/v1/courier/deliveries/active'));
      final offerResult = asMap(await widget.client.get('/v1/courier/offers'));
      final earningsResult = asMap(await widget.client.get('/v1/courier/earnings'));
      if (!mounted) return;
      setState(() {
        profile = result;
        activeDelivery = active['delivery'] == null ? null : asMap(active['delivery']);
        offers = asList(offerResult['items']);
        earnings = earningsResult;
        needsOnboarding = false;
      });
      _syncLocationHeartbeat();
    } on ApiException catch (cause) {
      if (cause.statusCode == 403 || cause.statusCode == 404) {
        if (mounted) setState(() => needsOnboarding = true);
      } else if (mounted) {
        setState(() => error = cause.message);
      }
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => initializing = false);
    }
  }

  Future<void> _refreshData() async {
    try {
      final active = asMap(await widget.client.get('/v1/courier/deliveries/active'));
      final offerResult = asMap(await widget.client.get('/v1/courier/offers'));
      final earningsResult = asMap(await widget.client.get('/v1/courier/earnings'));
      if (!mounted) return;
      setState(() {
        activeDelivery = active['delivery'] == null ? null : asMap(active['delivery']);
        offers = asList(offerResult['items']);
        earnings = earningsResult;
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    }
  }

  Future<void> _setAvailability({bool? online, bool? accepting}) async {
    final availability = asMap(profile?['availability']);
    final isOnline = online ?? availability['isOnline'] == true;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final position = isOnline ? await _location.currentPosition() : null;
      final result = asMap(await widget.client.put('/v1/courier/availability', {
        'isOnline': isOnline,
        'acceptingOffers': accepting ?? availability['acceptingOffers'] ?? true,
        if (position != null) 'latitude': position.latitude,
        if (position != null) 'longitude': position.longitude,
      }));
      if (!mounted) return;
      setState(() {
        profile = {...?profile, 'availability': {...availability, ...result}};
      });
      _syncLocationHeartbeat();
      await _refreshData();
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void _syncLocationHeartbeat() {
    final online = asMap(profile?['availability'])['isOnline'] == true;
    if (!online) {
      unawaited(_location.stop());
      return;
    }
    unawaited(_startLocationTracking());
  }

  Future<void> _startLocationTracking() async {
    if (_location.isRunning) return;
    final l10n = AppLocalizations.of(context);
    try {
      await _location.start(
        onPosition: (position) => unawaited(_reportPosition(position)),
        onError: (cause) {
          if (mounted) setState(() => error = cause.toString());
        },
        notificationTitle: l10n.courierLocationTitle,
        notificationText: l10n.courierLocationText,
      );
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    }
  }

  Future<void> _reportPosition(Position position) async {
    if (_sendingLocation) return;
    _sendingLocation = true;
    try {
      await widget.client.post('/v1/courier/location', {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'accuracyMeters': position.accuracy,
        'headingDegrees': position.heading,
        'speedMps': position.speed,
      });
    } catch (_) {
      // Heartbeats are best effort; the next position update retries.
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
      await _reportPosition(position);
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.liveLocationSent)));
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
          SnackBar(content: Text('${offer['orderNumber']} accepted. Head to the merchant.')),
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
      await widget.client.post('/v1/courier/offers/${offer['offerId']}/reject', {'reason': 'Not available'});
      await _refreshData();
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _transition(String orderId, String action, {String? proofCode, String? notes}) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.client.post('/v1/courier/deliveries/$orderId/$action', {
        'proofCode': ?proofCode,
        'notes': ?notes,
      });
      await _refreshData();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delivery updated: ${label(action)}.')));
      }
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _deliver(Map<String, dynamic> delivery) async {
    final proofController = TextEditingController();
    final notesController = TextEditingController();
    final required = delivery['deliveryProofRequired'] == true;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Complete delivery'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (required)
              TextField(
                controller: proofController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: "Customer's delivery code"),
              ),
            if (required) const SizedBox(height: 10),
            TextField(
              controller: notesController,
              decoration: const InputDecoration(labelText: 'Notes (optional)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Confirm delivery')),
        ],
      ),
    );
    final proof = proofController.text.trim();
    final notes = notesController.text.trim();
    proofController.dispose();
    notesController.dispose();
    if (confirmed != true) return;
    await _transition(
      delivery['orderId'] as String,
      'delivered',
      proofCode: proof.isEmpty ? null : proof,
      notes: notes.isEmpty ? null : notes,
    );
  }

  Future<void> _fail(Map<String, dynamic> delivery) async {
    final notesController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Report a failed delivery'),
        content: TextField(
          controller: notesController,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'What happened?'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Back')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Report failure')),
        ],
      ),
    );
    final notes = notesController.text.trim();
    notesController.dispose();
    if (confirmed != true || notes.isEmpty) return;
    await _transition(delivery['orderId'] as String, 'failed', notes: notes);
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
    final roles = (widget.client.session?.user['roles'] as List? ?? const []).map((role) => label(role.toString())).join(', ');
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
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.two_wheeler_outlined), selectedIcon: const Icon(Icons.two_wheeler), label: l10n.today),
          NavigationDestination(icon: const Icon(Icons.payments_outlined), selectedIcon: const Icon(Icons.payments), label: l10n.earnings),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: l10n.profile),
        ],
      ),
    );
  }

  Widget _todayView(bool online, Map<String, dynamic> availability) {
    final theme = Theme.of(context);
    final status = profile?['status']?.toString() ?? 'pending';
    final approved = status == 'approved';
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
        children: [
          if (error != null) ...[ErrorBanner(message: error!), const SizedBox(height: 12)],
          if (!approved)
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
                  Text('Account ${label(status)}', style: const TextStyle(fontWeight: FontWeight.w800)),
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
                            style: TextStyle(color: Color(0xFF98A59A), fontSize: 11, letterSpacing: 1.6, fontWeight: FontWeight.w800),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            online ? 'Online' : 'Offline',
                            style: theme.textTheme.headlineMedium?.copyWith(
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
                      onChanged: approved && !busy ? (value) => _setAvailability(online: value, accepting: value) : null,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                const Divider(color: Color(0xFF38453D), height: 1),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Accept new offers', style: TextStyle(color: Color(0xFFEEF0E6))),
                  subtitle: const Text('Pause this while you are on a delivery.', style: TextStyle(color: Color(0xFF98A59A), fontSize: 12)),
                  value: availability['acceptingOffers'] == true,
                  onChanged: online && approved && !busy ? (value) => _setAvailability(accepting: value) : null,
                  activeThumbColor: const Color(0xFF88C9A3),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: busy ? null : _sendLocation,
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
          Row(
            children: [
              Expanded(child: _statCard('Rating', (profile?['ratingAverage'] as num? ?? 0).toStringAsFixed(1), Icons.star_outline)),
              const SizedBox(width: 10),
              Expanded(child: _statCard('Deliveries', '${profile?['completedDeliveries'] ?? 0}', Icons.check_circle_outline)),
            ],
          ),
          const SizedBox(height: 20),
          if (activeDelivery != null) ...[
            Text('Active delivery', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            _activeDeliveryCard(activeDelivery!),
            const SizedBox(height: 20),
          ],
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Offers for you', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              if (busy) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
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
                Text(title, style: const TextStyle(color: Color(0xFF6B7468), fontSize: 12)),
                Text(value, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _offerCard(Map<String, dynamic> offer) {
    final theme = Theme.of(context);
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
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                  Text(
                    money(offer['compensationMinor'] as num?, offer['currency']?.toString()),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${offer['merchantName'] ?? 'Merchant'} · ${((offer['distanceToPickupMeters'] as num? ?? 0) / 1000).toStringAsFixed(1)} km away',
                style: const TextStyle(color: Color(0xFF6B7468), fontSize: 13),
              ),
              if (offer['deliveryAddress'] != null) ...[
                const SizedBox(height: 4),
                Text('Deliver to ${offer['deliveryAddress']}', style: const TextStyle(fontSize: 13)),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: busy ? null : () => _acceptOffer(offer),
                      child: const Text('Accept'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: busy ? null : () => _rejectOffer(offer),
                      child: const Text('Pass'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _activeDeliveryCard(Map<String, dynamic> delivery) {
    final theme = Theme.of(context);
    final assignmentStatus = delivery['assignmentStatus']?.toString();
    final orderStatus = delivery['orderStatus']?.toString();
    String action;
    String actionLabel;
    if (assignmentStatus == 'accepted') {
      action = 'arrived_pickup';
      actionLabel = 'Arrived at merchant';
    } else if (assignmentStatus == 'arrived_pickup') {
      action = 'picked_up';
      actionLabel = 'Confirm pickup';
    } else if (orderStatus != 'IN_TRANSIT') {
      action = 'in_transit';
      actionLabel = 'Start delivery';
    } else {
      action = 'delivered';
      actionLabel = 'Complete delivery';
    }
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
                    style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE4F0E8),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    label(assignmentStatus),
                    style: const TextStyle(color: Color(0xFF2F6B4F), fontSize: 11, fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _stopRow(Icons.storefront, 'Pickup', delivery['merchantName']?.toString() ?? '', delivery['pickupAddress']?.toString()),
            const SizedBox(height: 10),
            _stopRow(Icons.location_on_outlined, 'Drop-off', delivery['customerName']?.toString() ?? 'Customer', delivery['deliveryAddress']?.toString()),
            if (delivery['customerPhone'] != null) ...[
              const SizedBox(height: 8),
              Text('Customer phone: ${delivery['customerPhone']}', style: const TextStyle(fontSize: 13)),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: Text('Your earning', style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)))),
                Text(
                  money(delivery['courierEarningMinor'] as num?, delivery['currency']?.toString()),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ],
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: busy
                  ? null
                  : action == 'delivered'
                      ? () => _deliver(delivery)
                      : () => _transition(delivery['orderId'] as String, action),
              child: Text(busy ? 'Updating…' : actionLabel),
            ),
            const SizedBox(height: 6),
            TextButton(
              onPressed: busy ? null : () => _fail(delivery),
              style: TextButton.styleFrom(foregroundColor: const Color(0xFFA63A32)),
              child: const Text('Report a problem'),
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
              Text(title, style: const TextStyle(fontSize: 11, color: Color(0xFF6B7468), fontWeight: FontWeight.w700)),
              Text(name, style: const TextStyle(fontWeight: FontWeight.w700)),
              if (address != null && address.isNotEmpty)
                Text(address, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7468))),
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
    return RefreshIndicator(
      onRefresh: _refreshData,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
        children: [
          if (error != null) ...[ErrorBanner(message: error!), const SizedBox(height: 12)],
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: const Color(0xFF1E2A24),
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('LIFETIME EARNINGS', style: TextStyle(color: Color(0xFF98A59A), fontSize: 11, letterSpacing: 1.5, fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(
                  money(data['lifetimeEarningsMinor'] as num?),
                  style: const TextStyle(color: Color(0xFFEEF0E6), fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: -1),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(child: _darkStat('Tips', money(data['tipsMinor'] as num?))),
                    Expanded(child: _darkStat('Pending payout', money(data['pendingPayoutMinor'] as num?))),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(child: _statCard('Completed', '${data['completedDeliveries'] ?? 0}', Icons.check_circle_outline)),
              const SizedBox(width: 10),
              Expanded(child: _statCard('Payouts', '${payouts.length}', Icons.account_balance_wallet_outlined)),
            ],
          ),
          const SizedBox(height: 22),
          Text('Recent deliveries', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          if (recent.isEmpty) const Text('Delivered orders will appear here.', style: TextStyle(color: Color(0xFF6B7468))),
          ...recent.map(
            (item) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                title: Text(item['orderNumber']?.toString() ?? ''),
                subtitle: Text(shortDate(item['deliveredAt']?.toString())),
                trailing: Text(
                  money((item['earningMinor'] as num? ?? 0) + (item['tipMinor'] as num? ?? 0), item['currency']?.toString()),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ),
          ),
          if (payouts.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text('Payouts', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            ...payouts.map(
              (payout) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text('${shortDate(payout['periodStart']?.toString())} – ${shortDate(payout['periodEnd']?.toString())}'),
                  subtitle: Text(label(payout['status']?.toString())),
                  trailing: Text(
                    money(payout['netPayableMinor'] as num?, payout['currency']?.toString()),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _darkStat(String title, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(color: Color(0xFF98A59A), fontSize: 11)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(color: Color(0xFFEEF0E6), fontWeight: FontWeight.w700)),
      ],
    );
  }

  Widget _profileView(String roles) {
    final theme = Theme.of(context);
    final documents = asList(profile?['documents']);
    final vehicles = asList(profile?['vehicles']);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
      children: [
        if (error != null) ...[ErrorBanner(message: error!), const SizedBox(height: 12)],
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
                        (profile?['fullName']?.toString() ?? 'C').characters.first.toUpperCase(),
                        style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            profile?['fullName']?.toString() ?? 'Courier',
                            style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          const SizedBox(height: 2),
                          Text(label(profile?['status']?.toString()), style: const TextStyle(color: Color(0xFF6B7468))),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _profileRow('Vehicle', label(profile?['vehicleType']?.toString())),
                _profileRow('Plate', profile?['vehiclePlate']?.toString() ?? '—'),
                _profileRow('Capacity', '${profile?['capacityUnits'] ?? 1} units'),
                _profileRow('Phone', widget.client.session?.user['phoneE164']?.toString() ?? '—'),
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
                Text('Documents', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                if (documents.isEmpty) const Text('No documents uploaded.', style: TextStyle(color: Color(0xFF6B7468))),
                ...documents.map(
                  (document) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(label(document['documentType']?.toString())),
                    subtitle: Text(document['reviewNotes']?.toString() ?? shortDate(document['createdAt']?.toString())),
                    trailing: Text(
                      label(document['status']?.toString()),
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
                    ),
                  ),
                ),
                if (vehicles.isNotEmpty) ...[
                  const Divider(height: 26),
                  Text('Vehicles', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                  ...vehicles.map(
                    (vehicle) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text('${label(vehicle['vehicleType']?.toString())} ${vehicle['plateNumber'] ?? ''}'),
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
                  value: Localizations.localeOf(context).languageCode == 'am' ? 'am' : 'en',
                  underline: const SizedBox.shrink(),
                  items: [
                    DropdownMenuItem(value: 'en', child: Text(AppLocalizations.of(context).english)),
                    DropdownMenuItem(value: 'am', child: Text(AppLocalizations.of(context).amharic)),
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
          SizedBox(width: 92, child: Text(title, style: const TextStyle(color: Color(0xFF6B7468), fontSize: 13))),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
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
  final plateController = TextEditingController();
  String vehicleType = 'motorcycle';
  bool busy = false;
  String? error;

  @override
  void dispose() {
    nameController.dispose();
    plateController.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.post('/v1/courier/register', {
        'fullName': nameController.text.trim(),
        'vehicleType': vehicleType,
        if (plateController.text.trim().isNotEmpty) 'vehiclePlate': plateController.text.trim(),
        'capacityUnits': 1,
      }));
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
          if (error != null) ...[ErrorBanner(message: error!), const SizedBox(height: 12)],
          TextField(
            controller: nameController,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Full name'),
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
            onChanged: (value) => setState(() => vehicleType = value ?? 'motorcycle'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: plateController,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Vehicle plate (optional)'),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: busy ? null : _register,
            child: Text(busy ? 'Creating profile…' : 'Create courier profile'),
          ),
          const SizedBox(height: 10),
          const Text(
            'After registration, upload identity and vehicle documents through operations before your first delivery.',
            style: TextStyle(color: Color(0xFF6B7468), fontSize: 12, height: 1.5),
          ),
        ],
      ),
    );
  }
}
