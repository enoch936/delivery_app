import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'app_storage.dart';
import 'location_service.dart';
import 'push_service.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  throw UnimplementedError('apiClientProvider must be overridden in main.dart');
});

final appStorageProvider = Provider<AppStorage>((ref) {
  throw UnimplementedError('appStorageProvider must be overridden in main.dart');
});

final locationServiceProvider = Provider<LocationService>((ref) {
  throw UnimplementedError('locationServiceProvider must be overridden in main.dart');
});

final pushServiceProvider = Provider<PushService>((ref) {
  throw UnimplementedError('pushServiceProvider must be overridden in main.dart');
});
