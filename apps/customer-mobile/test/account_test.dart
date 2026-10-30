import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:customer_mobile/account/accessibility_controller.dart';
import 'package:customer_mobile/account/account_screen.dart';
import 'package:customer_mobile/account/address_book_screen.dart';
import 'package:customer_mobile/account/privacy_screen.dart';
import 'package:customer_mobile/app_storage.dart';
import 'package:customer_mobile/main.dart';

class FakeApiClient extends ApiClient {
  FakeApiClient(super.storage, this.routes);

  final Map<String, dynamic> routes;
  final List<String> requests = [];

  @override
  Future<dynamic> get(String path) async {
    requests.add('GET $path');
    return routes['GET $path'];
  }

  @override
  Future<dynamic> post(String path, [Object? body, Map<String, String>? headers]) async {
    requests.add('POST $path');
    return routes['POST $path'];
  }

  @override
  Future<dynamic> patch(String path, [Object? body]) async {
    requests.add('PATCH $path');
    return routes['PATCH $path'];
  }

  @override
  Future<dynamic> delete(String path) async {
    requests.add('DELETE $path');
    return routes['DELETE $path'];
  }
}

Future<(AppStorage, FakeApiClient)> harness(Map<String, dynamic> routes) async {
  SharedPreferences.setMockInitialValues({});
  final storage = AppStorage(await SharedPreferences.getInstance(), const FlutterSecureStorage());
  return (storage, FakeApiClient(storage, routes));
}

Map<String, dynamic> sampleProfile({Map<String, dynamic>? deletion}) => {
      'id': 'user-1',
      'phoneE164': '+251911234567',
      'displayName': 'Alem Tesfaye',
      'email': 'alem@example.com',
      'emailVerified': true,
      'preferredLocale': 'en',
      'marketingConsent': false,
      'analyticsConsent': false,
      'termsAcceptedAt': '2026-01-01T00:00:00.000Z',
      'privacyAcceptedAt': null,
      'accessibility': {
        'textScale': 1.0,
        'reduceMotion': false,
        'highContrast': false,
        'screenReaderHints': true,
      },
      'deletion': deletion,
      'favoriteCount': 2,
      'activeSessionCount': 1,
    };

void main() {
  test('AccessibilitySettings parses, clamps and serialises profile values', () {
    final settings = AccessibilitySettings.fromProfile({
      'accessibility': {'textScale': 2.6, 'reduceMotion': true, 'highContrast': true, 'screenReaderHints': false},
    });
    expect(settings.textScale, 2.0);
    expect(settings.reduceMotion, isTrue);
    expect(settings.highContrast, isTrue);
    expect(settings.screenReaderHints, isFalse);

    final json = settings.toApiJson();
    expect(json['textScale'], 2.0);
    expect(json['reduceMotion'], isTrue);
    expect(settings.copyWith(textScale: 1.3).textScale, 1.3);
  });

  testWidgets('account hub renders identity, completeness and destruction notice', (tester) async {
    final (storage, client) = await harness({
      'GET /v1/users/me': sampleProfile(deletion: {
        'status': 'pending',
        'requestedAt': '2026-01-01T00:00:00.000Z',
        'scheduledFor': '2026-01-31T00:00:00.000Z',
      }),
      'GET /v1/addresses': {
        'items': [
          {'id': 'a1', 'label': 'Home', 'isDefault': true},
        ],
      },
    });

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AccountScreen(
          client: client,
          user: {},
          onSignOut: () async {},
          onLocaleChanged: (_) {},
          onOpenCart: () async {},
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Alem Tesfaye'), findsOneWidget);
    expect(find.text('+251911234567'), findsOneWidget);
    expect(find.text('Personal information'), findsOneWidget);
    expect(find.text('1 saved'), findsOneWidget);
    expect(find.text('Deletion scheduled'), findsOneWidget);
    expect(find.text('5/5 complete'), findsOneWidget);
    expect(client.requests, contains('GET /v1/users/me'));
    expect(storage, isNotNull);
  });

  testWidgets('saved addresses shows an actionable empty state', (tester) async {
    final (_, client) = await harness({
      'GET /v1/addresses': {'items': []},
    });

    await tester.pumpWidget(MaterialApp(home: AddressBookScreen(client: client)));
    await tester.pumpAndSettle();

    expect(find.text('No saved addresses'), findsOneWidget);
    expect(find.text('Add address'), findsOneWidget);
  });

  testWidgets('privacy screen requests deletion and closes the account', (tester) async {
    var closed = false;
    final (_, client) = await harness({
      'POST /v1/users/me/deletion-request': {'requested': true},
    });

    await tester.pumpWidget(MaterialApp(
      home: PrivacyDataScreen(
        client: client,
        profile: sampleProfile(),
        onUpdated: (_) {},
        onAccountClosed: () async => closed = true,
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Personalised offers'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Delete my account'), 200);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request deletion'));
    await tester.pumpAndSettle();

    expect(closed, isTrue);
    expect(client.requests, contains('POST /v1/users/me/deletion-request'));
  });
}
