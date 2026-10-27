import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:customer_mobile/app_storage.dart';
import 'package:customer_mobile/main.dart';
import 'package:customer_mobile/push_service.dart';

void main() {
  testWidgets('shows the customer sign-in screen', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    final storage = AppStorage(await SharedPreferences.getInstance(), const FlutterSecureStorage());
    final client = ApiClient(storage);
    final push = PushService(
      app: 'customer',
      post: (path, body) async => {},
      delete: (path) async {},
      hasSession: () => false,
    );

    await tester.pumpWidget(DeliveryApp(client: client, storage: storage, push: push));
    await tester.pumpAndSettle();

    expect(find.text('Good food,\nright now.'), findsOneWidget);
    expect(find.text('Send sign-in code'), findsOneWidget);
  });
}
