import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'account/accessibility_controller.dart';
import 'account/account_screen.dart';
import 'app_localizations.dart';
import 'app_storage.dart';
import 'discovery/discovery_screen.dart';
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
    app: 'customer',
    post: client.post,
    delete: client.delete,
    hasSession: () => client.session != null,
    messengerKey: scaffoldMessengerKey,
  );
  await push.initialize();
  runApp(DeliveryApp(client: client, storage: storage, push: push));
}

class DeliveryApp extends StatefulWidget {
  const DeliveryApp({
    super.key,
    required this.client,
    required this.storage,
    required this.push,
  });

  final ApiClient client;
  final AppStorage storage;
  final PushService push;

  @override
  State<DeliveryApp> createState() => _DeliveryAppState();
}

class _DeliveryAppState extends State<DeliveryApp> {
  Locale? _locale;

  @override
  void initState() {
    super.initState();
    final code = widget.storage.localeCode;
    if (code != null && code.isNotEmpty) _locale = Locale(code);
    unawaited(accessibilityController.load(widget.storage));
  }

  void _changeLocale(String code) {
    setState(() => _locale = Locale(code));
    unawaited(widget.storage.setLocaleCode(code));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFFE8613D),
      brightness: Brightness.light,
      surface: const Color(0xFFFFFDF7),
    );
    return MaterialApp(
      title: 'delivery_app',
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
          centerTitle: false,
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
            backgroundColor: const Color(0xFF20261F),
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
        chipTheme: const ChipThemeData(
          side: BorderSide(color: Color(0xFFD9D5C7)),
          backgroundColor: Colors.transparent,
          selectedColor: Color(0xFF20261F),
          labelStyle: TextStyle(fontSize: 12),
        ),
      ),
      builder: (context, child) => ValueListenableBuilder<AccessibilitySettings>(
        valueListenable: accessibilityController,
        builder: (context, settings, _) {
          final base = MediaQuery.of(context);
          final systemScale = base.textScaler.scale(16) / 16;
          return MediaQuery(
            data: base.copyWith(
              textScaler: TextScaler.linear(systemScale * settings.textScale),
              disableAnimations: base.disableAnimations || settings.reduceMotion,
              highContrast: base.highContrast || settings.highContrast,
            ),
            child: ScaffoldMessenger(
              key: scaffoldMessengerKey,
              child: child ?? const SizedBox.shrink(),
            ),
          );
        },
      ),
      home: AuthGate(
        client: widget.client,
        storage: widget.storage,
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
  Session? session;
  StreamSubscription<List<ConnectivityResult>>? _connectivity;
  bool _flushing = false;
  bool offline = false;

  Future<dynamic> get(String path) => _send('GET', path);

  Future<dynamic> post(String path, [Object? body, Map<String, String>? headers]) =>
      _send('POST', path, body: body, headers: headers);

  Future<dynamic> patch(String path, [Object? body]) =>
      _send('PATCH', path, body: body);

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
    pendingSync.value = storage.queue().length;
    if (session != null) unawaited(mergeGuestCart());
  }

  /// Folds the pre-sign-in device cart into the account cart. Best effort:
  /// a failed merge must never block sign-in.
  Future<void> mergeGuestCart() async {
    if (session == null) return;
    try {
      await _send('POST', '/v1/cart/merge', body: const <String, dynamic>{});
    } catch (_) {
      // The guest cart stays on the device and can be merged on the next launch.
    }
  }

  Future<Map<String, dynamic>> reconcileCart() async {
    return asMap(await _send('POST', '/v1/cart/reconcile', body: const <String, dynamic>{}));
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

  Future<WebSocket> openTracking(String orderId) async {
    final token = accessToken;
    if (token == null) throw ApiException('Please sign in again.');
    final base = Uri.parse(apiBaseUrl);
    final basePath = base.path.endsWith('/')
        ? base.path.substring(0, base.path.length - 1)
        : base.path;
    final uri = base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: '$basePath/v1/tracking/$orderId/ws',
    );
    return WebSocket.connect(
      uri.toString(),
      headers: {'authorization': 'Bearer $token'},
    );
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
      request.headers.set('x-device-id', storage.ensureDeviceId());
      if (headers != null) {
        headers.forEach(request.headers.set);
      }
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
      await mergeGuestCart();
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
    await mergeGuestCart();
    return session!;
  }

  Future<void> signOut() async {
    final current = session;
    session = null;
    await storage.clearSession();
    await storage.clearQueued();
    await storage.clearDiscoveryData();
    pendingSync.value = 0;
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
      // The local session is discarded even if the server token expired.
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
  return '$whole.${parts[1]} $currency';
}

String label(String? value) {
  if (value == null || value.isEmpty) return '—';
  return value
      .toLowerCase()
      .split('_')
      .map((word) => word.isEmpty ? word : word[0].toUpperCase() + word.substring(1))
      .join(' ');
}

String formatClockTime(DateTime value) {
  final local = value.toLocal();
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '$hour:$minute';
}

/// "Today 19:30", "Tomorrow 08:00" or "Sat 2 Nov, 19:30" for scheduled orders.
String formatSchedule(DateTime value) {
  final local = value.toLocal();
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(local.year, local.month, local.day);
  final clock = formatClockTime(local);
  if (day == today) return 'Today $clock';
  if (day == today.add(const Duration(days: 1))) return 'Tomorrow $clock';
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return '${names[local.weekday - 1]} ${local.day}/${local.month} $clock';
}

/// Human opening-hours state for a merchant payload: "Open · closes 22:00",
/// "Closed · opens 07:00" or "Unavailable in your area".
String merchantHoursLabel(Map<String, dynamic> merchant) {
  if (merchant['isDeliverable'] == false) return 'Unavailable';
  final today = asMap(merchant['todayHours']);
  final isOpen = merchant['isOpen'] == true;
  if (today.isEmpty) return isOpen ? 'Open now' : 'Closed';
  if (today['closed'] == true) return 'Closed today';
  final open = today['open']?.toString();
  final close = today['close']?.toString();
  if (isOpen) return close == null ? 'Open now' : 'Open · closes $close';
  return open == null ? 'Closed' : 'Closed · opens $open';
}

String shortDate(String? value) {
  if (value == null) return '—';
  final date = DateTime.tryParse(value)?.toLocal();
  if (date == null) return '—';
  return '${date.day}/${date.month}/${date.year} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

class AuthGate extends StatefulWidget {
  const AuthGate({
    super.key,
    required this.client,
    required this.storage,
    required this.push,
    required this.onLocaleChanged,
  });

  final ApiClient client;
  final AppStorage storage;
  final PushService push;
  final ValueChanged<String> onLocaleChanged;

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
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
      if (!widget.storage.welcomeCompleted) {
        return WelcomeScreen(
          storage: widget.storage,
          onComplete: () => setState(() {}),
        );
      }
      return LoginScreen(
        client: widget.client,
        onSignedIn: _signedIn,
      );
    }
    return CustomerHome(
      client: widget.client,
      onSignedOut: _signedOut,
      onLocaleChanged: widget.onLocaleChanged,
    );
  }
}

class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key, required this.storage, required this.onComplete});

  final AppStorage storage;
  final VoidCallback onComplete;

  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen> {
  final controller = PageController();
  int page = 0;

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  Future<void> _complete() async {
    await widget.storage.setWelcomeCompleted();
    if (mounted) widget.onComplete();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final slides = [
      (l10n.welcomeTitle, l10n.welcomeBody, Icons.delivery_dining_outlined, const Color(0xFFE8613D)),
      (l10n.welcomeDiscoveryTitle, l10n.welcomeDiscoveryBody, Icons.storefront_outlined, const Color(0xFF2F6B4F)),
      (l10n.welcomeTrustTitle, l10n.welcomeTrustBody, Icons.track_changes_outlined, const Color(0xFF1E2A24)),
    ];
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView.builder(
                controller: controller,
                itemCount: slides.length,
                onPageChanged: (value) => setState(() => page = value),
                itemBuilder: (context, index) {
                  final slide = slides[index];
                  return Padding(
                    padding: const EdgeInsets.fromLTRB(28, 70, 28, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          height: 230,
                          width: double.infinity,
                          decoration: BoxDecoration(color: slide.$4, borderRadius: BorderRadius.circular(28)),
                          child: Icon(slide.$3, size: 96, color: Colors.white),
                        ),
                        const SizedBox(height: 34),
                        Text(slide.$1, style: Theme.of(context).textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -1.5)),
                        const SizedBox(height: 14),
                        Text(slide.$2, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: const Color(0xFF6B7468), height: 1.5)),
                      ],
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(28, 8, 28, 28),
              child: Row(
                children: [
                  Row(children: List.generate(slides.length, (index) => Container(width: 8, height: 8, margin: const EdgeInsets.only(right: 6), decoration: BoxDecoration(color: index == page ? const Color(0xFFE8613D) : const Color(0xFFD9D5C7), shape: BoxShape.circle)))),
                  const Spacer(),
                  FilledButton(
                    onPressed: page == slides.length - 1 ? _complete : () => controller.nextPage(duration: const Duration(milliseconds: 260), curve: Curves.easeOut),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(page == slides.length - 1 ? l10n.getStarted : l10n.next),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
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
  int resendSeconds = 0;
  Timer? resendTimer;
  String? error;

  @override
  void dispose() {
    phoneController.dispose();
    codeController.dispose();
    resendTimer?.cancel();
    super.dispose();
  }

  void _startResendCooldown() {
    resendTimer?.cancel();
    setState(() => resendSeconds = 30);
    resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (resendSeconds <= 1) {
        timer.cancel();
        setState(() => resendSeconds = 0);
      } else {
        setState(() => resendSeconds -= 1);
      }
    });
  }

  Future<void> sendCode() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final challenge = await widget.client.requestOtp(phoneController.text.trim());
      setState(() => challengeId = challenge['challengeId'] as String?);
      _startResendCooldown();
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
                color: Color(0xFFE8613D),
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(27),
                  topRight: Radius.circular(27),
                  bottomLeft: Radius.circular(27),
                  bottomRight: Radius.circular(6),
                ),
              ),
              child: const Center(
                child: Text(
                  'd',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 34,
                    fontFamily: 'serif',
                    height: 1,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 28),
            Text(
              l10n.signInTitle,
              style: theme.textTheme.displaySmall?.copyWith(
                fontWeight: FontWeight.w800,
                letterSpacing: -1.6,
                height: 1.02,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              challengeId == null
                  ? l10n.signInSubtitle
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
                textInputAction: TextInputAction.done,
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
                textInputAction: TextInputAction.done,
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
              TextButton(
                onPressed: busy || resendSeconds > 0 ? null : sendCode,
                child: Text(
                  resendSeconds > 0
                      ? '${l10n.resendCode} ${resendSeconds}s'
                      : l10n.resendCode,
                ),
              ),
            ],
            const SizedBox(height: 40),
            Text(
              '${l10n.terms} API: $apiBaseUrl',
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

class CustomerHome extends StatefulWidget {
  const CustomerHome({
    super.key,
    required this.client,
    required this.onSignedOut,
    required this.onLocaleChanged,
  });

  final ApiClient client;
  final VoidCallback onSignedOut;
  final ValueChanged<String> onLocaleChanged;

  @override
  State<CustomerHome> createState() => _CustomerHomeState();
}

class _CustomerHomeState extends State<CustomerHome> {
  int index = 0;

  Future<void> openCart() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => CartScreen(client: widget.client),
      ),
    );
  }

  Future<void> signOut() async {
    widget.onSignedOut();
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.client.session?.user ?? <String, dynamic>{};
    final l10n = AppLocalizations.of(context);
    final titles = [l10n.discover, l10n.orders, l10n.profile];
    return Scaffold(
      appBar: AppBar(
        title: Text(titles[index]),
        actions: [
          ValueListenableBuilder<int>(
            valueListenable: widget.client.pendingSync,
            builder: (context, pending, _) {
              if (pending == 0) return const SizedBox.shrink();
              return Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Tooltip(
                    message: '${l10n.pendingSync}: $pending',
                    child: Badge(label: Text('$pending'), child: const Icon(Icons.cloud_upload_outlined)),
                  ),
                ),
              );
            },
          ),
          IconButton(
            tooltip: l10n.cart,
            onPressed: openCart,
            icon: const Icon(Icons.shopping_bag_outlined),
          ),
          IconButton(
            tooltip: l10n.signOut,
            onPressed: signOut,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: IndexedStack(
        index: index,
        children: [
          DiscoveryScreen(client: widget.client),
          OrdersScreen(client: widget.client),
          AccountScreen(
            user: user,
            client: widget.client,
            onSignOut: signOut,
            onLocaleChanged: widget.onLocaleChanged,
            onOpenCart: openCart,
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.explore_outlined),
            selectedIcon: const Icon(Icons.explore),
            label: l10n.discover,
          ),
          NavigationDestination(
            icon: const Icon(Icons.receipt_long_outlined),
            selectedIcon: const Icon(Icons.receipt_long),
            label: l10n.orders,
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline),
            selectedIcon: const Icon(Icons.person),
            label: l10n.profile,
          ),
        ],
      ),
    );
  }
}

class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key, required this.client});
  final ApiClient client;

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> {
  final searchController = TextEditingController();
  List<Map<String, dynamic>> merchants = [];
  List<Map<String, dynamic>> categories = [];
  Set<String> favorites = {};
  List<String> recentSearches = [];
  String currentLocation = 'Bole, Addis Ababa';

  String? selectedCategory;
  bool openNowOnly = false;
  bool favoritesOnly = false;
  bool loading = true;
  String? error;

  int promoIndex = 0;
  Timer? promoTimer;

  final List<Map<String, String>> promoBanners = [
    {
      'title': 'Express Delivery',
      'subtitle': 'Hot meals & essentials in 25 mins',
      'code': 'FAST25',
    },
    {
      'title': '20% OFF First Order',
      'subtitle': 'Valid on all local merchants',
      'code': 'WELCOME20',
    },
    {
      'title': 'Parcel & Courier',
      'subtitle': 'Send packages anywhere in Addis',
      'code': 'EXPRESS',
    },
  ];

  @override
  void initState() {
    super.initState();
    _loadStateAndData();
    promoTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (mounted) {
        setState(() => promoIndex = (promoIndex + 1) % promoBanners.length);
      }
    });
  }

  @override
  void dispose() {
    searchController.dispose();
    promoTimer?.cancel();
    super.dispose();
  }

  void _loadStateAndData() {
    favorites = widget.client.storage.favoriteMerchantIds.toSet();
    recentSearches = widget.client.storage.recentSearches;
    currentLocation = widget.client.storage.selectedLocation;
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final query = <String>[];
      if (selectedCategory != null) query.add('category=$selectedCategory');
      final search = searchController.text.trim();
      if (search.isNotEmpty) {
        query.add('q=${Uri.encodeQueryComponent(search)}');
        await widget.client.storage.addRecentSearch(search);
        recentSearches = widget.client.storage.recentSearches;
      }
      final suffix = query.isEmpty ? '' : '?${query.join('&')}';
      final results = await Future.wait([
        widget.client.get('/v1/service-categories'),
        widget.client.get('/v1/merchants$suffix'),
      ]);
      if (!mounted) return;
      var fetched = asList(asMap(results[1])['items']);

      if (favoritesOnly) {
        fetched = fetched.where((m) => favorites.contains(m['id']?.toString())).toList();
      }
      if (openNowOnly) {
        fetched = fetched.where((m) => m['status'] == 'active' || m['isOpen'] == true).toList();
      }

      setState(() {
        categories = asList(asMap(results[0])['items']);
        merchants = fetched;
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void _toggleFavorite(String merchantId) async {
    final added = await widget.client.storage.toggleFavoriteMerchant(merchantId);
    setState(() {
      if (added) {
        favorites.add(merchantId);
      } else {
        favorites.remove(merchantId);
      }
    });
  }

  void _changeLocation() async {
    final locations = [
      'Bole, Addis Ababa',
      'Kazanchis, Addis Ababa',
      'CMC, Addis Ababa',
      'Sarbet, Addis Ababa',
      'Old Airport, Addis Ababa',
      'Piassa, Addis Ababa',
      'Megenagna, Addis Ababa',
    ];
    final selected = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Select Delivery Location', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              ...locations.map((loc) => ListTile(
                    leading: Icon(Icons.location_on_outlined, color: loc == currentLocation ? const Color(0xFFE8613D) : null),
                    title: Text(loc, style: TextStyle(fontWeight: loc == currentLocation ? FontWeight.w800 : FontWeight.w500)),
                    trailing: loc == currentLocation ? const Icon(Icons.check, color: Color(0xFFE8613D)) : null,
                    onTap: () => Navigator.pop(context, loc),
                  )),
            ],
          ),
        );
      },
    );
    if (selected != null && selected != currentLocation) {
      await widget.client.storage.setSelectedLocation(selected);
      setState(() => currentLocation = selected);
      _load();
    }
  }

  void _resetFilters() {
    searchController.clear();
    setState(() {
      selectedCategory = null;
      openNowOnly = false;
      favoritesOnly = false;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final promo = promoBanners[promoIndex];

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          // Location Selector Header
          InkWell(
            onTap: _changeLocation,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFE2DDD0).withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  const Icon(Icons.location_on, color: Color(0xFFE8613D), size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('DELIVER TO', style: theme.textTheme.labelSmall?.copyWith(fontSize: 10, color: const Color(0xFF6B7468), fontWeight: FontWeight.w800)),
                        Text(currentLocation, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w800)),
                      ],
                    ),
                  ),
                  const Icon(Icons.keyboard_arrow_down, color: Color(0xFF6B7468)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Search & Header Banner
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
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'DELIVERED AROUND ADDIS',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: const Color(0xFFF18A68),
                        letterSpacing: 1.6,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE8613D),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        promo['code']!,
                        style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  promo['title']!,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: const Color(0xFFEEF0E6),
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.8,
                  ),
                ),
                Text(
                  promo['subtitle']!,
                  style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFFB0B7AC)),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: searchController,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _load(),
                  decoration: InputDecoration(
                    hintText: 'Search meals, shops, products',
                    fillColor: const Color(0xFFFFFDF7),
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (searchController.text.isNotEmpty)
                          IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              searchController.clear();
                              _load();
                            },
                          ),
                        IconButton(
                          onPressed: _load,
                          icon: const Icon(Icons.arrow_forward),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Recent Searches Chips
          if (recentSearches.isNotEmpty) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Recent Searches', style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w800, color: const Color(0xFF6B7468))),
                TextButton(
                  onPressed: () async {
                    await widget.client.storage.clearRecentSearches();
                    setState(() => recentSearches = []);
                  },
                  child: const Text('Clear', style: TextStyle(fontSize: 12)),
                ),
              ],
            ),
            SizedBox(
              height: 32,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: recentSearches.map((term) => Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ActionChip(
                    label: Text(term, style: const TextStyle(fontSize: 11)),
                    avatar: const Icon(Icons.history, size: 14),
                    onPressed: () {
                      searchController.text = term;
                      _load();
                    },
                  ),
                )).toList(),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Quick Service Categories Tiles
          SizedBox(
            height: 80,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                _buildServiceTile(Icons.restaurant, 'Food', const Color(0xFFE8613D), () {
                  setState(() => selectedCategory = 'restaurants');
                  _load();
                }),
                _buildServiceTile(Icons.shopping_basket, 'Grocery', const Color(0xFF2F6B4F), () {
                  setState(() => selectedCategory = 'groceries');
                  _load();
                }),
                _buildServiceTile(Icons.medical_services, 'Pharmacy', const Color(0xFF1E88E5), () {
                  setState(() => selectedCategory = 'pharmacy');
                  _load();
                }),
                _buildServiceTile(Icons.storefront, 'Retail', const Color(0xFF8E24AA), () {
                  setState(() => selectedCategory = 'retail');
                  _load();
                }),
                _buildServiceTile(Icons.local_shipping, 'Parcel', const Color(0xFFD81B60), () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Express Parcel Courier Booking active in Addis Ababa')),
                  );
                }),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Category & Filter Chips
          SizedBox(
            height: 38,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: const Text('All'),
                    selected: selectedCategory == null && !openNowOnly && !favoritesOnly,
                    onSelected: (_) => _resetFilters(),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    avatar: const Icon(Icons.star, size: 16, color: Color(0xFFE8613D)),
                    label: const Text('Favorites'),
                    selected: favoritesOnly,
                    onSelected: (val) {
                      setState(() => favoritesOnly = val);
                      _load();
                    },
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    avatar: const Icon(Icons.schedule, size: 16),
                    label: const Text('Open Now'),
                    selected: openNowOnly,
                    onSelected: (val) {
                      setState(() => openNowOnly = val);
                      _load();
                    },
                  ),
                ),
                ...categories.map(
                  (category) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(category['displayName']?.toString() ?? ''),
                      selected: selectedCategory == category['slug'],
                      onSelected: (_) {
                        setState(() => selectedCategory = category['slug'] as String?);
                        _load();
                      },
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),

          // Merchant List Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                error == null ? 'Nearby Merchants (${merchants.length})' : 'Something went wrong',
                style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
              ),
              if (loading) const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ],
          ),
          const SizedBox(height: 12),

          if (error != null) ...[
            ErrorBanner(message: error!),
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: OutlinedButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Retry'),
              ),
            ),
          ],

          // Skeleton Loader while loading
          if (loading && merchants.isEmpty) ...[
            const MerchantCardSkeleton(),
            const MerchantCardSkeleton(),
            const MerchantCardSkeleton(),
          ],

          // Empty state with retry action
          if (!loading && error == null && merchants.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Icon(Icons.storefront_outlined, size: 48, color: Color(0xFF6B7468)),
                    const SizedBox(height: 12),
                    Text('No merchants found', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    Text(
                      'No matching stores or products found for current filters.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _resetFilters,
                      child: const Text('Reset All Filters'),
                    ),
                  ],
                ),
              ),
            ),

          // Merchant Cards
          if (!loading || merchants.isNotEmpty)
            ...merchants.map(
              (merchant) {
                final id = merchant['id']?.toString() ?? '';
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: MerchantCard(
                    merchant: merchant,
                    isFavorite: favorites.contains(id),
                    onFavoriteToggle: () => _toggleFavorite(id),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => MerchantScreen(
                          client: widget.client,
                          merchantId: id,
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildServiceTile(IconData icon, String title, Color color, VoidCallback onTap) {
    return Container(
      width: 76,
      margin: const EdgeInsets.only(right: 10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Column(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(icon, color: color, size: 26),
            ),
            const SizedBox(height: 6),
            Text(title, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700), maxLines: 1),
          ],
        ),
      ),
    );
  }
}

class MerchantCard extends StatelessWidget {
  const MerchantCard({
    super.key,
    required this.merchant,
    required this.onTap,
    required this.isFavorite,
    required this.onFavoriteToggle,
  });

  final Map<String, dynamic> merchant;
  final VoidCallback onTap;
  final bool isFavorite;
  final VoidCallback onFavoriteToggle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final categoryList = (merchant['serviceCategorySlugs'] as List? ?? const [])
        .map((value) => label(value.toString()))
        .take(2)
        .join(' · ');
    final isOpen = merchant['isOpen'] == true || merchant['status'] == 'active';
    final deliverable = merchant['isDeliverable'] != false;
    final rating = merchant['rating']?.toString() ?? '4.8';
    final etaMin = merchant['etaMinMinutes'];
    final etaMax = merchant['etaMaxMinutes'];
    final estTime = etaMin != null && etaMax != null
        ? '$etaMin-$etaMax min'
        : merchant['estimatedDeliveryTime']?.toString() ?? '25-35 min';
    final deliveryFeeMinor = merchant['deliveryFeeMinor'];
    final fee = deliveryFeeMinor is num
        ? money(deliveryFeeMinor, merchant['currency']?.toString() ?? 'ETB')
        : merchant['deliveryFee']?.toString() ?? 'ETB 50';
    final distance = merchant['distanceKm'];
    final tags = (merchant['tags'] as List? ?? const []).whereType<String>().take(2).toList();

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 62,
                    height: 62,
                    decoration: BoxDecoration(
                      color: const Color(0xFFF0EAD9),
                      borderRadius: BorderRadius.circular(15),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: merchant['logoUrl'] != null || merchant['coverImageUrl'] != null
                        ? Image.network(
                            (merchant['logoUrl'] ?? merchant['coverImageUrl']) as String,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stack) => const Icon(Icons.storefront),
                          )
                        : Center(
                            child: Text(
                              (merchant['displayName']?.toString() ?? 'S').characters.first,
                              style: const TextStyle(
                                fontSize: 26,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFFE8613D),
                              ),
                            ),
                          ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                merchant['displayName']?.toString() ?? 'Merchant',
                                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                              ),
                            ),
                            IconButton(
                              constraints: const BoxConstraints(),
                              padding: EdgeInsets.zero,
                              icon: Icon(
                                isFavorite ? Icons.star : Icons.star_border,
                                color: isFavorite ? const Color(0xFFE8613D) : const Color(0xFF9E9E9E),
                                size: 22,
                              ),
                              onPressed: onFavoriteToggle,
                            ),
                          ],
                        ),
                        if (merchant['description'] != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            merchant['description'].toString(),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                          ),
                        ],
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: isOpen ? const Color(0xFFE8F5E9) : const Color(0xFFFFEBEE),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                !deliverable ? 'UNAVAILABLE' : isOpen ? 'OPEN' : 'CLOSED',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                  color: !deliverable
                                      ? const Color(0xFF6B7468)
                                      : isOpen
                                          ? const Color(0xFF2E7D32)
                                          : const Color(0xFFC62828),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                [
                                  if (categoryList.isNotEmpty) categoryList,
                                  if (merchant['primaryLocationName'] != null) merchant['primaryLocationName'].toString(),
                                  merchantHoursLabel(merchant),
                                ].join(' · '),
                                style: theme.textTheme.labelSmall?.copyWith(color: const Color(0xFF6B7468)),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const Divider(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.star, size: 16, color: Color(0xFFE8613D)),
                      const SizedBox(width: 4),
                      Text(rating, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                      const SizedBox(width: 12),
                      const Icon(Icons.access_time, size: 16, color: Color(0xFF6B7468)),
                      const SizedBox(width: 4),
                      Text(estTime, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7468))),
                      if (distance is num) ...[
                        const SizedBox(width: 12),
                        const Icon(Icons.near_me_outlined, size: 16, color: Color(0xFF6B7468)),
                        const SizedBox(width: 4),
                        Text('${distance.toStringAsFixed(1)} km', style: const TextStyle(fontSize: 12, color: Color(0xFF6B7468))),
                      ],
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        fee,
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: Color(0xFF20261F)),
                      ),
                      if (tags.isNotEmpty)
                        Text(tags.join(' · '), style: const TextStyle(fontSize: 10, color: Color(0xFF6B7468))),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class MerchantScreen extends StatefulWidget {
  const MerchantScreen({super.key, required this.client, required this.merchantId, this.latitude, this.longitude});

  final ApiClient client;
  final String merchantId;
  final double? latitude;
  final double? longitude;

  @override
  State<MerchantScreen> createState() => _MerchantScreenState();
}

class _MerchantScreenState extends State<MerchantScreen> {
  Map<String, dynamic>? merchant;
  List<Map<String, dynamic>> products = [];
  bool loading = true;
  String? error;
  String? addingId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final locationQuery = widget.latitude != null && widget.longitude != null
          ? 'lat=${widget.latitude}&lng=${widget.longitude}' : '';
      final results = await Future.wait([
        widget.client.get('/v1/merchants/${widget.merchantId}?$locationQuery'),
        widget.client.get('/v1/merchants/${widget.merchantId}/products?limit=50&$locationQuery'),
      ]);
      if (!mounted) return;
      setState(() {
        merchant = asMap(results[0]);
        products = asList(asMap(results[1])['items']);
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _add(Map<String, dynamic> product) async {
    final groups = asList(product['optionGroups']);
    final currency = product['currency']?.toString();
    final basePrice = (product['basePriceMinor'] as num?) ?? 0;
    final available = product['quantityAvailable'] is num ? (product['quantityAvailable'] as num).toInt() : null;
    final maxQuantity = available == null ? 20 : available.clamp(1, 20);
    final selected = <String, Set<String>>{};
    var quantity = 1;
    for (final group in groups) {
      final groupId = group['id'].toString();
      selected[groupId] = asList(group['options'])
          .where((option) => option['isDefault'] == true && option['isAvailable'] != false)
          .map((option) => option['id'].toString())
          .toSet();
    }
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          double unitPrice = basePrice.toDouble();
          for (final group in groups) {
            final chosen = selected[group['id'].toString()] ?? <String>{};
            for (final option in asList(group['options'])) {
              if (chosen.contains(option['id'].toString())) {
                unitPrice += (option['priceDeltaMinor'] as num?)?.toDouble() ?? 0;
              }
            }
          }
          final missing = groups.where((group) {
            if (group['isRequired'] != true) return false;
            final chosen = selected[group['id'].toString()]?.length ?? 0;
            final minimum = ((group['minSelections'] as num?)?.toInt() ?? 0).clamp(1, 20);
            return chosen < minimum;
          }).toList();
          final multipleUnits = currency != null ? money((unitPrice * quantity).round(), currency) : '—';
          return Padding(
            padding: EdgeInsets.fromLTRB(20, 4, 20, 20 + MediaQuery.of(sheetContext).viewInsets.bottom),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(product['displayName']?.toString() ?? 'Item', style: Theme.of(sheetContext).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                  if (product['description'] != null) ...[
                    const SizedBox(height: 4),
                    Text(product['description'].toString(), style: const TextStyle(color: Color(0xFF6B7468), fontSize: 13)),
                  ],
                  if (product['imageUrl'] != null) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: Image.network(
                        product['imageUrl'].toString(),
                        width: double.infinity,
                        height: 170,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stack) => Container(
                          height: 170,
                          color: const Color(0xFFF0EAD9),
                          child: const Icon(Icons.local_mall_rounded, color: Color(0xFFE8613D), size: 44),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                  ],
                  const SizedBox(height: 14),
                  for (final group in groups) ...[
                    Text(
                      '${group['displayName']}${group['isRequired'] == true ? ' · required' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: asList(group['options']).map((option) {
                        final groupId = group['id'].toString();
                        final optionId = option['id'].toString();
                        final chosen = selected[groupId]?.contains(optionId) ?? false;
                        final disabled = option['isAvailable'] == false;
                        final delta = (option['priceDeltaMinor'] as num?)?.toInt() ?? 0;
                        final label = delta > 0
                            ? '${option['displayName']} +${money(delta, currency)}'
                            : option['displayName'].toString();
                        if (group['selectionType'] == 'multi') {
                          return FilterChip(
                            label: Text(label, style: const TextStyle(fontSize: 12)),
                            selected: chosen,
                            onSelected: disabled ? null : (value) {
                              setSheetState(() {
                                final set = selected.putIfAbsent(groupId, () => <String>{});
                                final max = (group['maxSelections'] as num?)?.toInt() ?? 1;
                                if (value) {
                                  if (set.length >= max) set.remove(set.first);
                                  set.add(optionId);
                                } else {
                                  set.remove(optionId);
                                }
                              });
                            },
                          );
                        }
                        return ChoiceChip(
                          label: Text(label, style: const TextStyle(fontSize: 12)),
                          selected: chosen,
                          onSelected: disabled ? null : (_) => setSheetState(() => selected[groupId] = {optionId}),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 12),
                  ],
                  Row(
                    children: [
                      const Text('Quantity', style: TextStyle(fontWeight: FontWeight.w700)),
                      const Spacer(),
                      IconButton.filledTonal(
                        onPressed: quantity <= 1 ? null : () => setSheetState(() => quantity--),
                        icon: const Icon(Icons.remove, size: 18),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Text('$quantity', style: const TextStyle(fontWeight: FontWeight.w800)),
                      ),
                      IconButton.filledTonal(
                        onPressed: quantity >= maxQuantity ? null : () => setSheetState(() => quantity++),
                        icon: const Icon(Icons.add, size: 18),
                      ),
                    ],
                  ),
                  if (available != null && available <= 5)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        available <= 0 ? 'Out of stock' : 'Only $available left',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: available <= 0 ? const Color(0xFFC62828) : const Color(0xFFB26A00)),
                      ),
                    ),
                  if (missing.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        'Choose ${missing.map((group) => group['displayName']).join(', ')} to continue.',
                        style: const TextStyle(fontSize: 12, color: Color(0xFFC62828)),
                      ),
                    ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: missing.isNotEmpty || available == 0
                          ? null
                          : () async {
                              setState(() => addingId = product['id'] as String?);
                              Navigator.of(sheetContext).pop(false);
                              try {
                                await widget.client.post('/v1/cart/items', {
                                  'productId': product['id'],
                                  'quantity': quantity,
                                  'optionIds': selected.values.expand((value) => value).toList(),
                                });
                                if (!mounted) return;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('${product['displayName']} added to cart')),
                                );
                                Navigator.of(context).pop(true);
                              } catch (cause) {
                                if (!mounted) return;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(cause.toString())),
                                );
                              } finally {
                                if (mounted) setState(() => addingId = null);
                              }
                            },
                      icon: const Icon(Icons.shopping_bag_outlined),
                      label: Text('Add · $multipleUnits'),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
    if (confirmed == true && mounted) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => CartScreen(client: widget.client)),
      );
      if (mounted) _load();
    }
  }

  Widget _availabilityCard(ThemeData theme) {
    final data = merchant ?? const <String, dynamic>{};
    final isOpen = data['isOpen'] == true;
    final deliverable = data['isDeliverable'] != false;
    final weekly = asList(data['weeklyHours']);
    final distance = data['distanceKm'];
    final fee = data['deliveryFeeMinor'] is num ? money(data['deliveryFeeMinor'] as num, 'ETB') : '—';
    final minOrder = data['minOrderMinor'] is num ? money(data['minOrderMinor'] as num, 'ETB') : '—';
    final nextOpen = DateTime.tryParse(data['nextOpenAt']?.toString() ?? '');
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: !deliverable
                        ? const Color(0xFFEFEAE0)
                        : isOpen
                            ? const Color(0xFFE8F5E9)
                            : const Color(0xFFFFEBEE),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    !deliverable ? 'NOT DELIVERABLE' : isOpen ? 'OPEN NOW' : 'CLOSED',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: !deliverable
                          ? const Color(0xFF6B7468)
                          : isOpen
                              ? const Color(0xFF2E7D32)
                              : const Color(0xFFC62828),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(merchantHoursLabel(data), style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600)),
                ),
              ],
            ),
            if (!deliverable) ...[
              const SizedBox(height: 8),
              Text(
                data['deliveryUnavailableReason']?.toString() ??
                    'Your delivery location is outside this merchant\'s service area.',
                style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFFC62828)),
              ),
            ],
            if (!isOpen && nextOpen != null) ...[
              const SizedBox(height: 6),
              Text('Opens ${formatClockTime(nextOpen)}', style: theme.textTheme.bodySmall),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 16,
              runSpacing: 6,
              children: [
                _availabilityStat(Icons.delivery_dining_rounded, 'Delivery',
                    '${data['etaMinMinutes'] ?? '—'}–${data['etaMaxMinutes'] ?? '—'} min'),
                _availabilityStat(Icons.near_me_outlined, 'Distance',
                    distance is num ? '${distance.toStringAsFixed(1)} km' : '—'),
                _availabilityStat(Icons.payments_outlined, 'Fee', fee),
                _availabilityStat(Icons.shopping_basket_outlined, 'Min order', minOrder),
              ],
            ),
            if (weekly.isNotEmpty)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                childrenPadding: const EdgeInsets.only(bottom: 8),
                title: const Text('Opening hours', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                children: [
                  for (final day in weekly)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(child: Text(day['label']?.toString() ?? '', style: theme.textTheme.bodySmall)),
                          Text(
                            day['closed'] == true
                                ? 'Closed'
                                : day['open'] == null || day['close'] == null
                                    ? 'Open all day'
                                    : '${day['open']} – ${day['close']}',
                            style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _availabilityStat(IconData icon, String label, String value) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: const Color(0xFF6B7468)),
        const SizedBox(width: 4),
        Text('$label: ', style: const TextStyle(fontSize: 11, color: Color(0xFF6B7468))),
        Text(value, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
      ],
    );
  }

  Widget _storefrontInfoCard(ThemeData theme) {
    final data = merchant ?? const <String, dynamic>{};
    final fulfillment = asMap(data['fulfillment']);
    final policy = asMap(data['policy']);
    final pickupLocations = asList(data['pickupLocations']);
    if (fulfillment.isEmpty && policy.isEmpty) return const SizedBox.shrink();
    final supportsPickup = fulfillment['supportsPickup'] == true;
    final allowsScheduling = fulfillment['allowsScheduling'] == true;
    final lead = (fulfillment['minScheduleLeadMinutes'] as num?)?.toInt() ?? 60;
    final days = (fulfillment['maxScheduleDays'] as num?)?.toInt() ?? 0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('How this store works', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _serviceChip(Icons.storefront_outlined, supportsPickup ? 'Collection available' : 'Delivery only'),
                _serviceChip(
                  Icons.schedule,
                  allowsScheduling && days > 0 ? 'Schedule up to $days day${days == 1 ? '' : 's'} · $lead min lead' : 'No scheduled orders',
                ),
              ],
            ),
            if (supportsPickup && fulfillment['pickupInstructions'] != null) ...[
              const SizedBox(height: 10),
              Text(
                fulfillment['pickupInstructions'].toString(),
                style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
              ),
            ],
            if (pickupLocations.isNotEmpty && supportsPickup) ...[
              const SizedBox(height: 6),
              for (final location in pickupLocations)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.place_outlined, size: 14, color: Color(0xFF6B7468)),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${location['name']}${location['addressLine'] == null ? '' : ' · ${location['addressLine']}'}',
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
            const SizedBox(height: 6),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 6),
              title: const Text('Policies', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              children: [
                if (policy['cancellationPolicy'] != null)
                  _policyRow('Cancellation', policy['cancellationPolicy'].toString()),
                if (policy['refundPolicy'] != null) _policyRow('Refunds', policy['refundPolicy'].toString()),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _serviceChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: const Color(0xFFF4F0E8), borderRadius: BorderRadius.circular(10)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: const Color(0xFF6B7468)),
          const SizedBox(width: 5),
          Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _policyRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
          Text(value, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7468))),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(merchant?['displayName']?.toString() ?? 'Merchant')),
      body: loading
          ? ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
              children: [
                const SkeletonBox(width: 220, height: 16),
                const SizedBox(height: 8),
                const SkeletonBox(width: double.infinity, height: 132, borderRadius: 18),
                const SizedBox(height: 20),
                const SkeletonBox(width: 160, height: 20),
                const SizedBox(height: 12),
                ...List.generate(
                  4,
                  (_) => const Padding(
                    padding: EdgeInsets.only(bottom: 10),
                    child: SkeletonBox(width: double.infinity, height: 76, borderRadius: 16),
                  ),
                ),
              ],
            )
          : error != null
              ? Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    ErrorBanner(message: error!),
                    OutlinedButton(onPressed: _load, child: const Text('Retry')),
                  ]),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 4, 20, 30),
                    children: [
                      if (merchant?['addressLine'] != null)
                        Text(
                          merchant!['addressLine'].toString(),
                          style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF6B7468)),
                        ),
                      const SizedBox(height: 18),
                      _availabilityCard(theme),
                      const SizedBox(height: 10),
                      _storefrontInfoCard(theme),
                      Text(
                        'Products & services',
                        style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 10),
                      if (products.isEmpty)
                        const EmptyState(
                          icon: Icons.restaurant_menu,
                          title: 'No products yet',
                          message: 'This merchant has not published products.',
                        ),
                      ...products.map(
                        (product) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Card(
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          product['displayName']?.toString() ?? 'Item',
                                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                                        ),
                                        if (product['description'] != null) ...[
                                          const SizedBox(height: 4),
                                          Text(
                                            product['description'].toString(),
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                            style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                                          ),
                                        ],
                                        const SizedBox(height: 8),
                                        Row(
                                          children: [
                                            Text(
                                              money(product['basePriceMinor'] as num?, product['currency']?.toString()),
                                              style: const TextStyle(fontWeight: FontWeight.w800),
                                            ),
                                            if (asList(product['optionGroups']).isNotEmpty) ...[
                                              const SizedBox(width: 6),
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(color: const Color(0xFFF0EBE1), borderRadius: BorderRadius.circular(6)),
                                                child: const Text('Customisable', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Color(0xFF6B7468))),
                                              ),
                                            ],
                                          ],
                                        ),
                                        if (product['stockState'] == 'low_stock')
                                          const Padding(
                                            padding: EdgeInsets.only(top: 4),
                                            child: Text('Low stock', style: TextStyle(fontSize: 11, color: Color(0xFFB26A00), fontWeight: FontWeight.w700)),
                                          ),
                                        if (product['stockState'] == 'out_of_stock' || product['isAvailable'] == false)
                                          const Padding(
                                            padding: EdgeInsets.only(top: 4),
                                            child: Text('Out of stock', style: TextStyle(fontSize: 11, color: Color(0xFFC62828), fontWeight: FontWeight.w700)),
                                          ),
                                      ],
                                    ),
                                  ),
                                  SizedBox(
                                    width: 72,
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(14),
                                      child: product['imageUrl'] != null
                                          ? Image.network(
                                              product['imageUrl'].toString(),
                                              fit: BoxFit.cover,
                                              errorBuilder: (context, error, stack) => Container(
                                                width: 72,
                                                color: const Color(0xFFF0EAD9),
                                                child: const Icon(Icons.local_mall_rounded, color: Color(0xFFE8613D), size: 26),
                                              ),
                                            )
                                          : Container(
                                              width: 72,
                                              color: const Color(0xFFF0EAD9),
                                              child: const Icon(Icons.local_mall_rounded, color: Color(0xFFE8613D), size: 26),
                                            ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  FilledButton.tonal(
                                    onPressed: product['isAvailable'] == true &&
                                            product['stockState'] != 'out_of_stock' &&
                                            addingId == null &&
                                            merchant?['isDeliverable'] != false &&
                                            merchant?['isOpen'] != false
                                        ? () => _add(product)
                                        : null,
                                    style: FilledButton.styleFrom(
                                      minimumSize: const Size(44, 44),
                                      padding: const EdgeInsets.symmetric(horizontal: 12),
                                    ),
                                    child: addingId == product['id']
                                        ? const SizedBox(
                                            width: 16,
                                            height: 16,
                                            child: CircularProgressIndicator(strokeWidth: 2),
                                          )
                                        : const Icon(Icons.add, size: 20),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => CartScreen(client: widget.client)),
          );
        },
        icon: const Icon(Icons.shopping_bag_outlined),
        label: const Text('View cart'),
      ),
    );
  }
}

class CartScreen extends StatefulWidget {
  const CartScreen({super.key, required this.client});
  final ApiClient client;

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  Map<String, dynamic>? cart;
  bool loading = true;
  String? error;
  bool updating = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final result = asMap(await widget.client.reconcileCart());
      final issues = asList(result['issues']);
      if (!mounted) return;
      setState(() {
        cart = asMap(result['cart']);
        error = null;
      });
      if (issues.isNotEmpty && mounted) {
        final messages = issues.map((issue) => issue['message']?.toString() ?? '').where((message) => message.isNotEmpty);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(messages.join('\n')), duration: const Duration(seconds: 5)),
        );
      }
    } on ApiException catch (cause) {
      // A stale offline cache must not hide an empty cart.
      if (cause.statusCode == 0) {
        try {
          final result = await widget.client.get('/v1/cart');
          if (!mounted) return;
          return setState(() => cart = asMap(result));
        } catch (_) {
          if (mounted) setState(() => error = cause.toString());
        }
      } else if (mounted) {
        setState(() => error = cause.toString());
      }
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _update(Map<String, dynamic> item, int quantity) async {
    setState(() => updating = true);
    try {
      final result = await widget.client.patch(
        '/v1/cart/items/${item['id']}',
        {'quantity': quantity},
      );
      if (!mounted) return;
      setState(() => cart = asMap(result));
      if (asList(cart?['items']).isEmpty) {
        Navigator.of(context).pop(true);
      }
    } catch (cause) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(cause.toString())),
      );
    } finally {
      if (mounted) setState(() => updating = false);
    }
  }

  Future<void> _clear() async {
    setState(() => updating = true);
    try {
      await widget.client.delete('/v1/cart');
      if (!mounted) return;
      setState(() => cart = null);
      Navigator.of(context).pop(true);
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => updating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = asList(cart?['items']);
    final empty = cart == null || items.isEmpty;
    final theme = Theme.of(context);
    final fulfillment = asMap(cart?['fulfillment']);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your cart'),
        actions: [
          if (!empty)
            IconButton(
              tooltip: 'Clear cart',
              onPressed: updating ? null : _clear,
              icon: const Icon(Icons.delete_outline),
            ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ErrorBanner(message: error!),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Retry'),
                      ),
                    ],
                  ),
              )
              : empty
                  ? const EmptyState(
                      icon: Icons.shopping_bag_outlined,
                      title: 'Your cart is empty',
                      message: 'Add something delicious from a nearby merchant.',
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 140),
                      children: [
                        Text(
                          cart!['merchantName']?.toString() ?? '',
                          style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 12),
                        ...items.map(
                          (item) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Card(
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            item['displayName']?.toString() ?? 'Item',
                                            style: const TextStyle(fontWeight: FontWeight.w700),
                                          ),
                                          if ((item['optionsLabel']?.toString() ?? '').isNotEmpty) ...[
                                            const SizedBox(height: 2),
                                            Text(
                                              item['optionsLabel'].toString(),
                                              style: const TextStyle(fontSize: 11, color: Color(0xFF6B7468)),
                                            ),
                                          ],
                                          const SizedBox(height: 4),
                                          Text(
                                            '${money(item['unitPriceMinor'] as num?, item['currency']?.toString())} · ${money(item['lineTotalMinor'] as num?, item['currency']?.toString())}',
                                            style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                                          ),
                                          if (item['stockIssue'] != null)
                                            Text(
                                              item['stockIssue'].toString(),
                                              style: const TextStyle(color: Color(0xFFA63A32), fontSize: 12),
                                            ),
                                          if (item['stockState'] == 'low_stock')
                                            const Text(
                                              'Low stock',
                                              style: TextStyle(color: Color(0xFFB26A00), fontSize: 11, fontWeight: FontWeight.w700),
                                            ),
                                        ],
                                      ),
                                    ),
                                    if (item['isAvailable'] == false)
                                      IconButton(
                                        tooltip: 'Remove',
                                        onPressed: updating ? null : () => _update(item, 0),
                                        icon: const Icon(Icons.delete_outline),
                                      )
                                    else ...[
                                      IconButton(
                                        onPressed: updating ? null : () => _update(item, (item['quantity'] as num).toInt() - 1),
                                        icon: Icon((item['quantity'] as num).toInt() <= 1 ? Icons.delete_outline : Icons.remove_circle_outline),
                                      ),
                                      Text(
                                        '${item['quantity']}',
                                        style: const TextStyle(fontWeight: FontWeight.w800),
                                      ),
                                      IconButton(
                                        onPressed: updating || (item['quantity'] as num).toInt() >= ((item['maxQuantity'] as num?)?.toInt() ?? 99)
                                            ? null
                                            : () => _update(item, (item['quantity'] as num).toInt() + 1),
                                        icon: const Icon(Icons.add_circle_outline),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Subtotal', style: TextStyle(color: Color(0xFF6B7468))),
                            Text(
                              money(cart!['itemsSubtotalMinor'] as num?, cart!['currency']?.toString()),
                              style: const TextStyle(fontWeight: FontWeight.w800),
                            ),
                          ],
                        ),
                        if (fulfillment['supportsPickup'] == true || fulfillment['allowsScheduling'] == true) ...[
                          const SizedBox(height: 14),
                          Wrap(
                            spacing: 8,
                            runSpacing: 6,
                            children: [
                              if (fulfillment['supportsPickup'] == true)
                                const _CartHint(icon: Icons.storefront_outlined, label: 'Collect in store available'),
                              if (fulfillment['allowsScheduling'] == true && ((fulfillment['maxScheduleDays'] as num?)?.toInt() ?? 0) > 0)
                                const _CartHint(icon: Icons.schedule, label: 'Schedule for later'),
                            ],
                          ),
                        ],
                        if (cart?['policy'] is Map && asMap(cart!['policy'])['cancellationPolicy'] != null) ...[
                          const SizedBox(height: 12),
                          Text(
                            asMap(cart!['policy'])['cancellationPolicy'].toString(),
                            style: const TextStyle(fontSize: 11, color: Color(0xFF6B7468)),
                          ),
                        ],
                      ],
                    ),
      bottomNavigationBar: empty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                child: FilledButton(
                  onPressed: updating
                      ? null
                      : () async {
                          final navigator = Navigator.of(context);
                          final placed = await navigator.push<bool>(
                            MaterialPageRoute<bool>(
                              builder: (_) => CheckoutScreen(
                                client: widget.client,
                                merchantId: cart!['merchantId'] as String,
                              ),
                            ),
                          );
                          if (placed == true && mounted) navigator.pop();
                        },
                  child: Text('Checkout · ${money(cart!['itemsSubtotalMinor'] as num?, cart!['currency']?.toString())}'),
                ),
              ),
            ),
    );
  }
}

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key, required this.client, required this.merchantId});

  final ApiClient client;
  final String merchantId;

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  List<Map<String, dynamic>> addresses = [];
  String? selectedAddress;
  Map<String, dynamic>? quote;
  Map<String, dynamic>? order;
  bool loading = true;
  bool busy = false;
  String? error;
  bool showAddressForm = false;
  String fulfillmentType = 'delivery';
  Map<String, dynamic>? merchantInfo;
  String? pickupLocationId;
  DateTime? scheduledFor;

  final labelController = TextEditingController(text: 'Home');
  final recipientController = TextEditingController();
  final phoneController = TextEditingController();
  final addressController = TextEditingController();
  final instructionsController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadAddresses();
    _loadMerchant();
  }

  Future<void> _loadMerchant() async {
    try {
      final result = asMap(await widget.client.get('/v1/merchants/${widget.merchantId}'));
      if (!mounted) return;
      final locations = asList(result['pickupLocations']);
      setState(() {
        merchantInfo = result;
        pickupLocationId = pickupLocationId ?? (locations.isEmpty ? null : locations.first['id']?.toString());
      });
    } catch (_) {
      // Delivery checkout still works when storefront details cannot be loaded.
    }
  }

  Map<String, dynamic> get _fulfillment => asMap(merchantInfo?['fulfillment']);

  Future<void> _pickSchedule() async {
    final maxDays = (_fulfillment['maxScheduleDays'] as num?)?.toInt() ?? 0;
    if (maxDays <= 0) return;
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(Duration(days: maxDays)),
      initialDate: now,
      helpText: 'Choose an order date',
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(now.add(const Duration(hours: 1))));
    if (time == null || !mounted) return;
    setState(() {
      scheduledFor = DateTime(date.year, date.month, date.day, time.hour, time.minute);
      quote = null;
    });
  }

  @override
  void dispose() {
    labelController.dispose();
    recipientController.dispose();
    phoneController.dispose();
    addressController.dispose();
    instructionsController.dispose();
    super.dispose();
  }

  Future<void> _loadAddresses() async {
    try {
      final result = await widget.client.get('/v1/addresses');
      final items = asList(asMap(result)['items']);
      if (!mounted) return;
      setState(() {
        addresses = items;
        selectedAddress = items.isEmpty
            ? null
            : items.firstWhere(
                (address) => address['isDefault'] == true,
                orElse: () => items.first,
              )['id'] as String?;
        showAddressForm = items.isEmpty;
        error = null;
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _createAddress() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.client.post('/v1/addresses', {
        'label': labelController.text.trim(),
        'recipientName': recipientController.text.trim(),
        'phoneE164': phoneController.text.trim(),
        'addressLine': addressController.text.trim(),
        'deliveryInstructions': instructionsController.text.trim().isEmpty
            ? null
            : instructionsController.text.trim(),
        'latitude': 9.0306,
        'longitude': 38.7406,
        'isDefault': true,
      });
      final created = asMap(result);
      await _loadAddresses();
      if (mounted) {
        setState(() {
          selectedAddress = created['id'] as String?;
          showAddressForm = false;
        });
      }
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _quoteOrder() async {
    if (fulfillmentType == 'delivery' && selectedAddress == null) return;
    if (fulfillmentType == 'pickup' && pickupLocationId == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.client.post('/v1/checkout/quote', {
        'merchantId': widget.merchantId,
        'fulfillmentType': fulfillmentType,
        if (fulfillmentType == 'delivery') 'deliveryAddressId': selectedAddress,
        if (fulfillmentType == 'pickup') 'pickupLocationId': pickupLocationId,
        if (scheduledFor != null) 'scheduledFor': scheduledFor!.toUtc().toIso8601String(),
        'tipMinor': 0,
      });
      if (mounted) setState(() => quote = asMap(result));
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _placeOrder() async {
    final currentQuote = quote;
    if (currentQuote == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.postQueued(
        '/v1/orders',
        {'quoteId': currentQuote['quoteId']},
        {'Idempotency-Key': 'mobile-${DateTime.now().microsecondsSinceEpoch}'},
      ));
      if (!mounted) return;
      if (result['queued'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context).savedOffline)),
        );
      } else {
        setState(() {
          order = result;
          quote = null;
        });
      }
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _pay(String method) async {
    final currentOrder = order;
    if (currentOrder == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final payment = asMap(await widget.client.post(
        '/v1/payments/orders/${currentOrder['id']}/initiate',
        {'method': method},
      ));
      if (method == 'sandbox') {
        await widget.client.post(
          '/v1/payments/sandbox/${payment['paymentId']}/complete',
          {'outcome': 'succeeded'},
        );
      }
      if (method == 'stripe' || method == 'telebirr') {
        final checkoutUrl = payment['checkoutUrl']?.toString();
        if (checkoutUrl == null || checkoutUrl.isEmpty) {
          throw StateError('The payment provider did not return a checkout URL.');
        }
        final launched = await launchUrl(Uri.parse(checkoutUrl), mode: LaunchMode.externalApplication);
        if (!launched) throw StateError('Could not open the payment page.');
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(method == 'telebirr'
              ? 'Complete the Telebirr payment, then return and refresh the status.'
              : 'Complete the card payment in your browser, then return and refresh the status.')),
        );
        return;
      }
      final refreshed = await widget.client.get('/v1/orders/${currentOrder['id']}');
      if (mounted) setState(() => order = asMap(refreshed));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(method == 'cash' ? 'Cash payment selected. Pay the courier on delivery.' : 'Sandbox payment completed.')),
      );
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _refreshOrder() async {
    final currentOrder = order;
    if (currentOrder == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final refreshed = await widget.client.get('/v1/orders/${currentOrder['id']}');
      if (mounted) setState(() => order = asMap(refreshed));
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (loading) {
      return Scaffold(appBar: AppBar(title: const Text('Checkout')), body: const Center(child: CircularProgressIndicator()));
    }
    if (order != null) {
      return _orderView(theme);
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
        children: [
          if (error != null) ...[ErrorBanner(message: error!), const SizedBox(height: 14)],
          if (_fulfillment['supportsPickup'] == true) ...[
            Text('How do you want it?', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'delivery', icon: Icon(Icons.delivery_dining_outlined), label: Text('Delivery')),
                ButtonSegment(value: 'pickup', icon: Icon(Icons.storefront_outlined), label: Text('Collect')),
              ],
              selected: {fulfillmentType},
              onSelectionChanged: (selection) {
                setState(() {
                  fulfillmentType = selection.first;
                  quote = null;
                });
              },
            ),
            const SizedBox(height: 18),
          ],
          if (fulfillmentType == 'delivery') ...[
            Text('Deliver to', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            RadioGroup<String>(
              groupValue: selectedAddress,
              onChanged: (value) => setState(() {
                selectedAddress = value;
                quote = null;
              }),
              child: Column(
                children: addresses.map(
                  (address) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: RadioListTile<String>(
                      value: address['id'] as String,
                      title: Text('${address['label']} · ${address['recipientName']}'),
                      subtitle: Text(address['addressLine']?.toString() ?? ''),
                      tileColor: const Color(0xFFFFFDF7),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                        side: const BorderSide(color: Color(0xFFD9D5C7)),
                      ),
                    ),
                  ),
                ).toList(),
              ),
            ),
            TextButton.icon(
              onPressed: () => setState(() => showAddressForm = !showAddressForm),
              icon: Icon(showAddressForm ? Icons.close : Icons.add_location_alt_outlined),
              label: Text(showAddressForm ? 'Cancel new address' : 'Add a new address'),
            ),
            if (showAddressForm) ...[
              const SizedBox(height: 6),
              TextField(controller: labelController, decoration: const InputDecoration(labelText: 'Label')),
              const SizedBox(height: 10),
              TextField(controller: recipientController, decoration: const InputDecoration(labelText: 'Recipient name')),
              const SizedBox(height: 10),
              TextField(controller: phoneController, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (+251…)')),
              const SizedBox(height: 10),
              TextField(controller: addressController, decoration: const InputDecoration(labelText: 'Address line')),
              const SizedBox(height: 10),
              TextField(controller: instructionsController, decoration: const InputDecoration(labelText: 'Delivery instructions (optional)')),
              const SizedBox(height: 10),
              OutlinedButton(
                onPressed: busy ? null : _createAddress,
                child: const Text('Save address'),
              ),
            ],
          ] else ...[
            Text('Collect from', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            RadioGroup<String>(
              groupValue: pickupLocationId,
              onChanged: (value) => setState(() {
                pickupLocationId = value;
                quote = null;
              }),
              child: Column(
                children: asList(merchantInfo?['pickupLocations']).map(
                  (location) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: RadioListTile<String>(
                      value: location['id'] as String,
                      title: Text(location['name']?.toString() ?? 'Store'),
                      subtitle: Text(location['addressLine']?.toString() ?? ''),
                      tileColor: const Color(0xFFFFFDF7),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                        side: const BorderSide(color: Color(0xFFD9D5C7)),
                      ),
                    ),
                  ),
                ).toList(),
              ),
            ),
            if (_fulfillment['pickupInstructions'] != null)
              Text(
                _fulfillment['pickupInstructions'].toString(),
                style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
              ),
          ],
          if ((_fulfillment['maxScheduleDays'] as num? ?? 0) > 0) ...[
            const SizedBox(height: 16),
            Text('When?', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  label: const Text('As soon as possible'),
                  selected: scheduledFor == null,
                  onSelected: (_) => setState(() {
                    scheduledFor = null;
                    quote = null;
                  }),
                ),
                ChoiceChip(
                  avatar: const Icon(Icons.schedule, size: 16),
                  label: Text(scheduledFor == null ? 'Schedule for later' : formatSchedule(scheduledFor!)),
                  selected: scheduledFor != null,
                  onSelected: (_) => _pickSchedule(),
                ),
              ],
            ),
          ],
          const SizedBox(height: 22),
          if (quote == null)
            FilledButton(
              onPressed: busy || (fulfillmentType == 'delivery' ? selectedAddress == null : pickupLocationId == null)
                  ? null
                  : _quoteOrder,
              child: Text(busy ? 'Calculating…' : 'Review totals'),
            )
          else _quoteView(theme),
        ],
      ),
    );
  }

  Widget _quoteView(ThemeData theme) {
    final breakdown = asMap(quote!['breakdown']);
    final lines = asList(quote!['lines']);
    final fulfillment = asMap(quote!['fulfillment']);
    final isPickup = fulfillment['type'] == 'pickup';
    final pickup = asMap(fulfillment['pickup']);
    final scheduledAt = DateTime.tryParse(fulfillment['scheduledFor']?.toString() ?? '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Order summary', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 10),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                ...lines.map(
                  (line) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${line['quantity']} × ${line['displayName']}'),
                              if ((line['optionsLabel']?.toString() ?? '').isNotEmpty)
                                Text(
                                  line['optionsLabel'].toString(),
                                  style: const TextStyle(fontSize: 11, color: Color(0xFF6B7468)),
                                ),
                            ],
                          ),
                        ),
                        Text(money(line['lineTotalMinor'] as num?, line['currency']?.toString())),
                      ],
                    ),
                  ),
                ),
                const Divider(height: 24),
                _amountRow('Items', breakdown['itemsSubtotalMinor'] as num?, breakdown['currency']?.toString()),
                _amountRow(isPickup ? 'Collection' : 'Delivery', breakdown['deliveryFeeMinor'] as num?, breakdown['currency']?.toString()),
                _amountRow('Service fee', breakdown['serviceFeeMinor'] as num?, breakdown['currency']?.toString()),
                if ((breakdown['discountMinor'] as num? ?? 0) > 0)
                  _amountRow('Discount', -(breakdown['discountMinor'] as num), breakdown['currency']?.toString()),
                _amountRow('Tax', breakdown['taxMinor'] as num?, breakdown['currency']?.toString()),
                const Divider(height: 24),
                _amountRow('Total', breakdown['totalMinor'] as num?, breakdown['currency']?.toString(), bold: true),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    isPickup
                        ? 'Collect from ${pickup['name'] ?? 'the store'} · ready in about ${breakdown['deliveryEstimateMinutes'] ?? '—'} min'
                        : 'Estimated ${breakdown['deliveryEstimateMinutes'] ?? '—'} min · ${((breakdown['distanceMeters'] as num? ?? 0) / 1000).toStringAsFixed(1)} km',
                    style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                  ),
                ),
                if (scheduledAt != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        'Scheduled for ${formatSchedule(scheduledAt)}',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF2E7D32)),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: busy ? null : _placeOrder,
          child: Text(busy ? 'Placing order…' : 'Place order'),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: busy ? null : () => setState(() => quote = null),
          child: const Text('Back to options'),
        ),
      ],
    );
  }

  Widget _orderView(ThemeData theme) {
    final current = order!;
    final awaitingPayment = current['status'] == 'AWAITING_PAYMENT';
    final totals = asMap(current['totals']);
    final provider = (quote == null ? '' : asMap(quote!['breakdown'])['paymentProvider']?.toString()) ?? '';
    return Scaffold(
      appBar: AppBar(
        title: const Text('Order placed'),
        automaticallyImplyLeading: false,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: const Color(0xFF1E2A24),
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.check_circle_outline, color: Color(0xFF88C9A3), size: 36),
                const SizedBox(height: 14),
                Text(
                  current['orderNumber']?.toString() ?? 'Order',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: const Color(0xFFEEF0E6),
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  '${label(current['status']?.toString())} · ${money(totals['totalMinor'] as num?, current['currency']?.toString())}',
                  style: const TextStyle(color: Color(0xFFB7C1B8)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          if (error != null) ...[ErrorBanner(message: error!), const SizedBox(height: 12)],
          if (awaitingPayment && provider == 'sandbox')
            FilledButton(
              onPressed: busy ? null : () => _pay('sandbox'),
              child: const Text('Pay now (sandbox)'),
            ),
          if (awaitingPayment && provider == 'sandbox') const SizedBox(height: 8),
          if (awaitingPayment && provider == 'stripe')
            FilledButton.icon(
              onPressed: busy ? null : () => _pay('stripe'),
              icon: const Icon(Icons.credit_card),
              label: const Text('Pay with card (Stripe)'),
            ),
          if (awaitingPayment && provider == 'stripe') const SizedBox(height: 8),
          if (awaitingPayment && provider == 'telebirr')
            FilledButton.icon(
              onPressed: busy ? null : () => _pay('telebirr'),
              icon: const Icon(Icons.phone_android),
              label: const Text('Pay with Telebirr'),
            ),
          if (awaitingPayment && provider == 'telebirr') const SizedBox(height: 8),
          OutlinedButton(
            onPressed: busy ? null : () => _pay('cash'),
            child: const Text('Pay cash on delivery'),
          ),
          if (awaitingPayment && (provider == 'stripe' || provider == 'telebirr'))
            TextButton.icon(
              onPressed: busy ? null : _refreshOrder,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh payment status'),
            ),
          if (awaitingPayment && provider == 'chapa')
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text('Card checkout is enabled on the API. Complete the Chapa redirect on a production build.'),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  Widget _amountRow(String title, num? amount, String? currency, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400),
            ),
          ),
          Text(
            money(amount, currency),
            style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400),
          ),
        ],
      ),
    );
  }
}

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, required this.client});
  final ApiClient client;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  List<Map<String, dynamic>> orders = [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = await widget.client.get('/v1/orders?limit=50');
      if (!mounted) return;
      setState(() => orders = asList(asMap(result)['items']));
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
        children: [
          if (error != null) ErrorBanner(message: error!),
          if (loading && orders.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 120),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (!loading && orders.isEmpty && error == null)
            const EmptyState(
              icon: Icons.receipt_long_outlined,
              title: 'No orders yet',
              message: 'Your delivery history will appear here.',
            ),
          ...orders.map(
            (order) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.all(14),
                  title: Text(
                    order['merchantName']?.toString() ?? 'Merchant',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: Text(
                      '${order['orderNumber']} · ${order['itemCount']} items\n${label(order['status']?.toString())} · ${shortDate(order['createdAt']?.toString())}',
                      style: const TextStyle(height: 1.4),
                    ),
                  ),
                  isThreeLine: true,
                  trailing: Text(
                    money(order['totalMinor'] as num?, order['currency']?.toString()),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  onTap: () async {
                    await Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => OrderDetailScreen(
                          client: widget.client,
                          orderId: order['id'] as String,
                        ),
                      ),
                    );
                    _load();
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.client, required this.orderId});

  final ApiClient client;
  final String orderId;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  Map<String, dynamic>? order;
  Map<String, dynamic>? liveTracking;
  WebSocket? _liveSocket;
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  bool liveConnected = false;
  bool loading = true;
  bool busy = false;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
    _connectLiveTracking();
  }

  Future<void> _connectLiveTracking() async {
    if (!mounted || widget.client.accessToken == null) return;
    _reconnectTimer?.cancel();
    try {
      final socket = await widget.client.openTracking(widget.orderId);
      if (!mounted) {
        await socket.close();
        return;
      }
      _liveSocket?.close();
      _liveSocket = socket;
      _reconnectAttempt = 0;
      setState(() => liveConnected = true);
      socket.listen(
        (message) {
          try {
            final decoded = jsonDecode(message.toString());
            if (decoded is Map && decoded['data'] is Map && mounted) {
              setState(() => liveTracking = asMap(decoded['data']));
            }
          } catch (_) {
            // Ignore malformed frames and keep the last good snapshot.
          }
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (!mounted) return;
    setState(() => liveConnected = false);
    if (_reconnectTimer?.isActive ?? false) return;
    if (_reconnectAttempt >= 5) return;
    const delays = [2, 5, 10, 20, 30];
    final delay = delays[_reconnectAttempt.clamp(0, delays.length - 1)];
    _reconnectAttempt += 1;
    _reconnectTimer = Timer(Duration(seconds: delay), _connectLiveTracking);
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    _liveSocket?.close();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final result = await widget.client.get('/v1/orders/${widget.orderId}');
      if (!mounted) return;
      setState(() {
        order = asMap(result);
        error = null;
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _cancel() async {
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancel this order?'),
        content: TextField(
          controller: reasonController,
          decoration: const InputDecoration(labelText: 'Reason'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Keep order')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Cancel order')),
        ],
      ),
    );
    final reason = reasonController.text.trim();
    reasonController.dispose();
    if (confirmed != true) return;
    if (reason.length < 3) {
      setState(() => error = 'Please give a cancellation reason.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.postQueued('/v1/orders/${widget.orderId}/cancel', {'reason': reason}));
      if (!mounted) return;
      if (result['queued'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context).savedOffline)),
        );
      } else {
        setState(() => order = result);
      }
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
      appBar: AppBar(title: Text(order?['orderNumber']?.toString() ?? 'Order')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : order == null
              ? Padding(padding: const EdgeInsets.all(20), child: ErrorBanner(message: error ?? 'Order not found'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
                    children: [
                      if (error != null) ...[ErrorBanner(message: error!), const SizedBox(height: 12)],
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(18),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                order!['merchant'] is Map
                                    ? asMap(order!['merchant'])['displayName']?.toString() ?? ''
                                    : '',
                                style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                '${label(order!['status']?.toString())} · ${label(order!['paymentStatus']?.toString())}',
                                style: theme.textTheme.bodyMedium?.copyWith(color: const Color(0xFF6B7468)),
                              ),
                              if (order!['deliveryCode'] != null) ...[
                                const SizedBox(height: 14),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF0EAD9),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Text(
                                    'Delivery code: ${order!['deliveryCode']}',
                                    style: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.2),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      if (liveTracking != null) ...[
                        const SizedBox(height: 14),
                        _LiveTrackingCard(tracking: liveTracking!, connected: liveConnected),
                      ],
                      const SizedBox(height: 14),
                      Text('Items', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 8),
                      ...asList(order!['items']).map(
                        (item) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              Expanded(child: Text('${item['quantity']} × ${item['displayName']}')),
                              Text(money(item['lineTotalMinor'] as num?, order!['currency']?.toString())),
                            ],
                          ),
                        ),
                      ),
                      const Divider(height: 28),
                      ..._totals(order!),
                      const SizedBox(height: 18),
                      Text('Timeline', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 8),
                      ...asList(order!['timeline']).map(
                        (event) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Padding(
                                padding: EdgeInsets.only(top: 4),
                                child: Icon(Icons.circle, size: 8, color: Color(0xFFE8613D)),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  '${label(event['toStatus']?.toString())} · ${shortDate(event['createdAt']?.toString())}',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (asMap(order!['capabilities'])['canCancel'] == true) ...[
                        const SizedBox(height: 20),
                        OutlinedButton(
                          onPressed: busy ? null : _cancel,
                          style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFFA63A32)),
                          child: const Text('Cancel order'),
                        ),
                      ],
                    ],
                  ),
                ),
    );
  }

  List<Widget> _totals(Map<String, dynamic> detail) {
    final totals = asMap(detail['totals']);
    final currency = detail['currency']?.toString();
    Widget row(String title, num? amount, {bool bold = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(
            children: [
              Expanded(child: Text(title, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400))),
              Text(money(amount, currency), style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w400)),
            ],
          ),
        );
    return [
      row('Items', totals['itemsSubtotalMinor'] as num?),
      row('Delivery', totals['deliveryFeeMinor'] as num?),
      row('Service fee', totals['serviceFeeMinor'] as num?),
      row('Tax', totals['taxMinor'] as num?),
      row('Tip', totals['tipMinor'] as num?),
      row('Total', totals['totalMinor'] as num?, bold: true),
    ];
  }
}

class _LiveTrackingCard extends StatelessWidget {
  const _LiveTrackingCard({required this.tracking, required this.connected});

  final Map<String, dynamic> tracking;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final courier = asMap(tracking['courier']);
    final location = asMap(courier['location']);
    final distance = courier['distanceToDestinationMeters'] as num?;
    final eta = courier['etaMinutes'] as num?;
    final destination = asMap(tracking['destination']);
    final active = tracking['liveTrackingEnabled'] == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.near_me_outlined, size: 20),
                const SizedBox(width: 8),
                Text('Live delivery', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const Spacer(),
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: connected ? const Color(0xFF2F6B4F) : const Color(0xFFA63A32),
                  ),
                ),
                const SizedBox(width: 6),
                Text(connected ? 'Live' : 'Reconnecting', style: theme.textTheme.labelSmall),
              ],
            ),
            const SizedBox(height: 10),
            Text(label(tracking['status']?.toString()), style: const TextStyle(fontWeight: FontWeight.w700)),
            if (courier['displayName'] != null) ...[
              const SizedBox(height: 6),
              Text('Courier: ${courier['displayName']}'),
            ],
            if (courier['vehicleType'] != null)
              Text('Vehicle: ${label(courier['vehicleType']?.toString())}'),
            if (distance != null || eta != null) ...[
              const SizedBox(height: 8),
              Text([
                if (distance != null) '${(distance / 1000).toStringAsFixed(1)} km away',
                if (eta != null) 'about $eta min',
              ].join(' · ')),
            ],
            if (location['lastSeenAt'] != null) ...[
              const SizedBox(height: 4),
              Text('Location updated ${shortDate(location['lastSeenAt']?.toString())}', style: theme.textTheme.labelSmall),
            ],
            if (destination['latitude'] != null && destination['longitude'] != null) ...[
              const SizedBox(height: 4),
              Text(
                'Destination: ${(destination['latitude'] as num).toStringAsFixed(5)}, ${(destination['longitude'] as num).toStringAsFixed(5)}',
                style: theme.textTheme.labelSmall,
              ),
            ],
            if (!active) ...[
              const SizedBox(height: 8),
              Text('Live location is paused for this order.', style: theme.textTheme.labelSmall),
            ],
          ],
        ),
      ),
    );
  }
}

class _CartHint extends StatelessWidget {
  const _CartHint({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: const Color(0xFFF4F0E8), borderRadius: BorderRadius.circular(10)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: const Color(0xFF6B7468)),
          const SizedBox(width: 5),
          Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 70, horizontal: 24),
      child: Column(
        children: [
          Icon(icon, size: 48, color: const Color(0xFFB7B3AB)),
          const SizedBox(height: 14),
          Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
          ),
        ],
      ),
    );
  }
}

class SkeletonBox extends StatefulWidget {
  const SkeletonBox({
    super.key,
    required this.width,
    required this.height,
    this.borderRadius = 12.0,
  });

  final double width;
  final double height;
  final double borderRadius;

  @override
  State<SkeletonBox> createState() => _SkeletonBoxState();
}

class _SkeletonBoxState extends State<SkeletonBox> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..repeat(reverse: true);
    _animation = Tween<double>(begin: 0.35, end: 0.75).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, _) {
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            color: const Color(0xFFE2DDD0).withValues(alpha: _animation.value),
            borderRadius: BorderRadius.circular(widget.borderRadius),
          ),
        );
      },
    );
  }
}

class MerchantCardSkeleton extends StatelessWidget {
  const MerchantCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const SkeletonBox(width: 62, height: 62, borderRadius: 15),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  SkeletonBox(width: 140, height: 16),
                  SizedBox(height: 8),
                  SkeletonBox(width: 200, height: 12),
                  SizedBox(height: 8),
                  SkeletonBox(width: 100, height: 10),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}




