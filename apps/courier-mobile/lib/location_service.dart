import 'dart:async';
import 'dart:io';

import 'package:geolocator/geolocator.dart';

class LocationService {
  StreamSubscription<Position>? _subscription;
  bool _backgroundEnabled = false;

  bool get isRunning => _subscription != null;
  bool get backgroundEnabled => _backgroundEnabled;

  Future<LocationPermission> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationServiceException('Turn on location services to receive deliveries.');
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission != LocationPermission.whileInUse &&
      permission != LocationPermission.always) {
      throw LocationServiceException('Location permission is required while you are online.');
    }
    return permission;
  }

  Future<void> start({
    required void Function(Position position) onPosition,
    required void Function(Object error) onError,
    required String notificationTitle,
    required String notificationText,
    required bool activeDelivery,
  }) async {
    final permission = await ensurePermission();
    if (_subscription != null) return;
    _backgroundEnabled = permission == LocationPermission.always;
    final accuracy = activeDelivery
        ? LocationAccuracy.high
        : LocationAccuracy.medium;
    final distanceFilter = activeDelivery ? 15 : 50;
    final interval = activeDelivery
        ? const Duration(seconds: 20)
        : const Duration(seconds: 60);
    final settings = Platform.isAndroid
        ? AndroidSettings(
            accuracy: accuracy,
            distanceFilter: distanceFilter,
            intervalDuration: interval,
            foregroundNotificationConfig: _backgroundEnabled
                ? ForegroundNotificationConfig(
                    notificationTitle: notificationTitle,
                    notificationText: notificationText,
                    notificationChannelName: 'Courier location',
                    enableWakeLock: true,
                    setOngoing: true,
                  )
                : null,
          )
        : Platform.isIOS
            ? AppleSettings(
            accuracy: accuracy,
            distanceFilter: distanceFilter,
            allowBackgroundLocationUpdates: _backgroundEnabled,
            showBackgroundLocationIndicator: _backgroundEnabled,
                pauseLocationUpdatesAutomatically: false,
              )
            : const LocationSettings(
              accuracy: LocationAccuracy.medium,
              distanceFilter: 50,
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
    _backgroundEnabled = false;
  }

  Future<Position> currentPosition() async {
    await ensurePermission();
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
  }

  Future<bool> openAppSettings() => Geolocator.openAppSettings();
}

class LocationServiceException implements Exception {
  LocationServiceException(this.message);
  final String message;

  @override
  String toString() => message;
}
