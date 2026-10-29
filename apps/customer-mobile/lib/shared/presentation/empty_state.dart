import 'package:flutter/material.dart';

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app_localizations.dart';
import 'app_storage.dart';
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
            minimumSize: const Size.fromHeight(50),
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
      home: AuthGate(
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
    required this.push,
    required this.onLocaleChanged,
  });

  final ApiClient client;
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
          ExploreScreen(client: widget.client),
          OrdersScreen(client: widget.client),
          ProfileScreen(
            user: user,
            onSignOut: signOut,
            onOpenCart: openCart,
            client: widget.client,
            onLocaleChanged: widget.onLocaleChanged,
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
  String? selectedCategory;
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
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
      if (search.isNotEmpty) query.add('q=${Uri.encodeQueryComponent(search)}');
      final suffix = query.isEmpty ? '' : '?${query.join('&')}';
      final results = await Future.wait([
        widget.client.get('/v1/service-categories'),
        widget.client.get('/v1/merchants$suffix'),
      ]);
      if (!mounted) return;
      setState(() {
        categories = asList(asMap(results[0])['items']);
        merchants = asList(asMap(results[1])['items']);
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
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
                  'DELIVERED AROUND ADDIS',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: const Color(0xFFF18A68),
                    letterSpacing: 1.6,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  'What are you craving?',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: const Color(0xFFEEF0E6),
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.8,
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: searchController,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _load(),
                  decoration: InputDecoration(
                    hintText: 'Search meals, shops, merchants',
                    fillColor: const Color(0xFFFFFDF7),
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: IconButton(
                      onPressed: _load,
                      icon: const Icon(Icons.arrow_forward),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 38,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: const Text('All'),
                    selected: selectedCategory == null,
                    onSelected: (_) {
                      setState(() => selectedCategory = null);
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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                error == null ? 'Nearby kitchens' : 'Something went wrong',
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
          if (error != null) ErrorBanner(message: error!),
          if (!loading && error == null && merchants.isEmpty)
            const EmptyState(
              icon: Icons.storefront_outlined,
              title: 'No merchants found',
              message: 'Try another search or category.',
            ),
          ...merchants.map(
            (merchant) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: MerchantCard(
                merchant: merchant,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => MerchantScreen(
                      client: widget.client,
                      merchantId: merchant['id'] as String,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class MerchantCard extends StatelessWidget {
  const MerchantCard({super.key, required this.merchant, required this.onTap});

  final Map<String, dynamic> merchant;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final categories = (merchant['serviceCategorySlugs'] as List? ?? const [])
        .map((value) => label(value.toString()))
        .take(2)
        .join(' · ');
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
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
                child: merchant['logoUrl'] != null
                    ? Image.network(
                        merchant['logoUrl'] as String,
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
                    Text(
                      merchant['displayName']?.toString() ?? 'Merchant',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    if (merchant['description'] != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        merchant['description'].toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      [if (categories.isNotEmpty) categories, if (merchant['primaryLocationName'] != null) merchant['primaryLocationName'].toString()].join(' · '),
                      style: theme.textTheme.labelSmall?.copyWith(color: const Color(0xFF6B7468)),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Color(0xFF6B7468)),
            ],
          ),
        ),
      ),
    );
  }
}

class MerchantScreen extends StatefulWidget {
  const MerchantScreen({super.key, required this.client, required this.merchantId});

  final ApiClient client;
  final String merchantId;

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
      final results = await Future.wait([
        widget.client.get('/v1/merchants/${widget.merchantId}'),
        widget.client.get('/v1/merchants/${widget.merchantId}/products?limit=50'),
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
    setState(() => addingId = product['id'] as String?);
    try {
      await widget.client.post('/v1/cart/items', {
        'productId': product['id'],
        'quantity': 1,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${product['displayName']} added to cart')),
      );
    } catch (cause) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(cause.toString())),
      );
    } finally {
      if (mounted) setState(() => addingId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(merchant?['displayName']?.toString() ?? 'Merchant')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Padding(
                  padding: const EdgeInsets.all(20),
                  child: ErrorBanner(message: error!),
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
                      Text(
                        'Menu',
                        style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 10),
                      if (products.isEmpty)
                        const EmptyState(
                          icon: Icons.restaurant_menu,
                          title: 'No dishes yet',
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
                                        Text(
                                          money(product['basePriceMinor'] as num?, product['currency']?.toString()),
                                          style: const TextStyle(fontWeight: FontWeight.w800),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  FilledButton.tonal(
                                    onPressed: product['isAvailable'] == true && addingId == null
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
      final result = await widget.client.get('/v1/cart');
      if (!mounted) return;
      setState(() {
        cart = asMap(result);
        error = null;
      });
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
    } catch (cause) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(cause.toString())),
      );
    } finally {
      if (mounted) setState(() => updating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = asList(cart?['items']);
    final empty = cart == null || items.isEmpty;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Your cart')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Padding(padding: const EdgeInsets.all(20), child: ErrorBanner(message: error!))
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
                                          const SizedBox(height: 4),
                                          Text(
                                            money(item['lineTotalMinor'] as num?, item['currency']?.toString()),
                                            style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                                          ),
                                          if (item['stockIssue'] != null)
                                            Text(
                                              item['stockIssue'].toString(),
                                              style: const TextStyle(color: Color(0xFFA63A32), fontSize: 12),
                                            ),
                                        ],
                                      ),
                                    ),
                                    IconButton(
                                      onPressed: updating ? null : () => _update(item, (item['quantity'] as num).toInt() - 1),
                                      icon: const Icon(Icons.remove_circle_outline),
                                    ),
                                    Text(
                                      '${item['quantity']}',
                                      style: const TextStyle(fontWeight: FontWeight.w800),
                                    ),
                                    IconButton(
                                      onPressed: updating ? null : () => _update(item, (item['quantity'] as num).toInt() + 1),
                                      icon: const Icon(Icons.add_circle_outline),
                                    ),
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

  final labelController = TextEditingController(text: 'Home');
  final recipientController = TextEditingController();
  final phoneController = TextEditingController();
  final addressController = TextEditingController();
  final instructionsController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadAddresses();
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
    if (selectedAddress == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.client.post('/v1/checkout/quote', {
        'merchantId': widget.merchantId,
        'deliveryAddressId': selectedAddress,
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
          Text('Deliver to', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          RadioGroup<String>(
            groupValue: selectedAddress,
            onChanged: (value) => setState(() => selectedAddress = value),
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
          const SizedBox(height: 22),
          if (quote == null)
            FilledButton(
              onPressed: selectedAddress == null || busy ? null : _quoteOrder,
              child: Text(busy ? 'Calculating…' : 'Review delivery fee'),
            )
          else _quoteView(theme),
        ],
      ),
    );
  }

  Widget _quoteView(ThemeData theme) {
    final breakdown = asMap(quote!['breakdown']);
    final lines = asList(quote!['lines']);
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
                      children: [
                        Expanded(child: Text('${line['quantity']} × ${line['displayName']}')),
                        Text(money(line['lineTotalMinor'] as num?, line['currency']?.toString())),
                      ],
                    ),
                  ),
                ),
                const Divider(height: 24),
                _amountRow('Items', breakdown['itemsSubtotalMinor'] as num?, breakdown['currency']?.toString()),
                _amountRow('Delivery', breakdown['deliveryFeeMinor'] as num?, breakdown['currency']?.toString()),
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
                    'Estimated ${breakdown['deliveryEstimateMinutes'] ?? '—'} min · ${((breakdown['distanceMeters'] as num? ?? 0) / 1000).toStringAsFixed(1)} km',
                    style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
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
          child: const Text('Back to address'),
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

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({
    super.key,
    required this.user,
    required this.onSignOut,
    required this.onOpenCart,
    required this.client,
    required this.onLocaleChanged,
  });

  final Map<String, dynamic> user;
  final Future<void> Function() onSignOut;
  final Future<void> Function() onOpenCart;
  final ApiClient client;
  final ValueChanged<String> onLocaleChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final localeCode = Localizations.localeOf(context).languageCode == 'am' ? 'am' : 'en';
    final roles = (user['roles'] as List? ?? const []).map((role) => label(role.toString())).join(', ');
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: const Color(0xFF1E2A24),
                  child: Text(
                    (user['displayName']?.toString() ?? user['phoneE164']?.toString() ?? 'U').characters.first.toUpperCase(),
                    style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user['displayName']?.toString() ?? 'Delivery customer',
                        style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        user['phoneE164']?.toString() ?? user['email']?.toString() ?? '',
                        style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                      ),
                      if (roles.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(roles, style: theme.textTheme.labelSmall?.copyWith(color: const Color(0xFF6B7468))),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.shopping_bag_outlined),
                title: Text(l10n.yourCart),
                trailing: const Icon(Icons.chevron_right),
                onTap: onOpenCart,
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.language),
                title: Text(l10n.language),
                trailing: DropdownButton<String>(
                  value: localeCode,
                  underline: const SizedBox.shrink(),
                  items: [
                    DropdownMenuItem(value: 'en', child: Text(l10n.english)),
                    DropdownMenuItem(value: 'am', child: Text(l10n.amharic)),
                  ],
                  onChanged: (value) {
                    if (value != null) onLocaleChanged(value);
                  },
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.support_agent),
                title: Text(l10n.helpAndSupport),
                subtitle: Text(l10n.helpSubtitle),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.logout),
                title: Text(l10n.signOut),
                onTap: onSignOut,
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Text(
          '${l10n.connectedTo} $apiBaseUrl',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
        ),
      ],
    );
  }
}
