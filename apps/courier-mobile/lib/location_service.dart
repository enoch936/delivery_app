import 'dart:async';
import 'dart:io';

import 'package:geolocator/geolocator.dart';

class LocationService {
  StreamSubscription<Position>? _subscription;

  bool get isRunning => _subscription != null;

  Future<void> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationServiceException('Turn on location services to receive deliveries.');
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      throw LocationServiceException('Location permission is required while you are online.');
    }
  }

  Future<void> start({
    required void Function(Position position) onPosition,
    required void Function(Object error) onError,
    required String notificationTitle,
    required String notificationText,
  }) async {
    await ensurePermission();
    if (_subscription != null) return;
    final settings = Platform.isAndroid
        ? AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 10,
            intervalDuration: const Duration(seconds: 15),
            foregroundNotificationConfig: ForegroundNotificationConfig(
              notificationTitle: notificationTitle,
              notificationText: notificationText,
              notificationChannelName: 'Courier location',
              enableWakeLock: true,
              setOngoing: true,
            ),
          )
        : Platform.isIOS
            ? AppleSettings(
                accuracy: LocationAccuracy.high,
                distanceFilter: 10,
                allowBackgroundLocationUpdates: true,
                showBackgroundLocationIndicator: true,
                pauseLocationUpdatesAutomatically: false,
              )
            : const LocationSettings(
                accuracy: LocationAccuracy.high,
                distanceFilter: 10,
              );
    _subscription = Geolocator.getPositionStream(locationSettings: settings).listen(
      onPosition,
      onError: onError,
      cancelOnError: false,
    );
  }

  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  Future<Position> currentPosition() async {
    await ensurePermission();
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
  }
}

class LocationServiceException implements Exception {
  LocationServiceException(this.message);
  final String message;

  @override
  String toString() => message;
}
