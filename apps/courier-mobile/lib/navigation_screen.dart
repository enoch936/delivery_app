import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import 'main.dart';

class NavigationScreen extends StatefulWidget {
  const NavigationScreen({
    super.key,
    required this.client,
    required this.title,
    this.latitude,
    this.longitude,
    this.address,
  });

  final ApiClient client;
  final String title;
  final double? latitude;
  final double? longitude;
  final String? address;

  @override
  State<NavigationScreen> createState() => _NavigationScreenState();
}

class _NavigationScreenState extends State<NavigationScreen> {
  MapLibreMapController? _map;
  Map<String, dynamic>? _route;
  LatLng? _origin;
  LatLng? _destination;
  String _styleUrl = _absoluteStyle('/api/v1/maps/styles/hybrid/style.json');
  String? _error;
  bool _loading = true;
  bool _styleReady = false;
  bool _drawn = false;

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  static String _absoluteStyle(String path) {
    final value = Uri.tryParse(path);
    if (value != null && value.hasScheme) return path;
    final base = Uri.parse(apiBaseUrl);
    return base
        .replace(
          path: path.startsWith('/') ? path : '/$path',
          query: null,
          fragment: null,
        )
        .toString();
  }

  Future<void> _prepare() async {
    setState(() {
      _loading = true;
      _drawn = false;
      _route = null;
      _error = null;
    });
    try {
      final config = asMap(await widget.client.get('/v1/maps/config'));
      final defaultStyle = config['defaultStyle']?.toString() ?? 'hybrid';
      final styles = asMap(config['styleUrls']);
      final path =
          styles[defaultStyle]?.toString() ??
          '/api/v1/maps/styles/hybrid/style.json';
      _styleUrl = _absoluteStyle(path);

      final destination = _destinationFromWidget() ?? await _geocodeAddress();
      if (destination == null) {
        throw const FormatException('This stop has no usable map location.');
      }
      _destination = destination;

      final origin = await _currentLocation();
      _origin = origin;

      if (origin != null) {
        final result = await widget.client.post('/v1/maps/route', {
          'locations': [
            {'latitude': origin.latitude, 'longitude': origin.longitude},
            {
              'latitude': destination.latitude,
              'longitude': destination.longitude,
            },
          ],
          'profile': 'motorcycle',
          'alternatives': 0,
        });
        _route = asMap(result);
      }
    } catch (cause) {
      _error = cause.toString().replaceFirst('FormatException: ', '');
    } finally {
      if (mounted) {
        setState(() => _loading = false);
        _draw();
      }
    }
  }

  LatLng? _destinationFromWidget() {
    final latitude = widget.latitude;
    final longitude = widget.longitude;
    if (latitude == null || longitude == null) return null;
    return LatLng(latitude, longitude);
  }

  Future<LatLng?> _geocodeAddress() async {
    final address = widget.address?.trim() ?? '';
    if (address.isEmpty) return null;
    final result = asMap(
      await widget.client.get(
        '/v1/maps/search?q=${Uri.encodeQueryComponent(address)}&limit=1',
      ),
    );
    final rows = asList(result['results']);
    if (rows.isEmpty) return null;
    final first = asMap(rows.first);
    final latitude = (first['latitude'] as num?)?.toDouble();
    final longitude = (first['longitude'] as num?)?.toDouble();
    if (latitude == null || longitude == null) return null;
    return LatLng(latitude, longitude);
  }

  Future<LatLng?> _currentLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );
      return LatLng(position.latitude, position.longitude);
    } catch (_) {
      return null;
    }
  }

  List<LatLng> _routePoints() {
    final geometry = asMap(_route?['geometry']);
    final rawCoordinates = geometry['coordinates'];
    if (rawCoordinates is! List) return const [];
    final points = <LatLng>[];
    for (final coordinate in rawCoordinates) {
      if (coordinate is! List || coordinate.length < 2) continue;
      final longitude = (coordinate[0] as num?)?.toDouble();
      final latitude = (coordinate[1] as num?)?.toDouble();
      if (latitude != null && longitude != null) {
        points.add(LatLng(latitude, longitude));
      }
    }
    return points;
  }

  Future<void> _draw() async {
    final map = _map;
    if (!_styleReady || map == null || _drawn) return;
    _drawn = true;
    try {
      await map.clearLines();
      await map.clearCircles();
      final points = _routePoints();
      if (_origin != null) {
        await map.addCircle(
          CircleOptions(
            geometry: _origin,
            circleRadius: 8,
            circleColor: '#0B6E99',
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 2.5,
          ),
        );
      }
      if (_destination != null) {
        await map.addCircle(
          CircleOptions(
            geometry: _destination,
            circleRadius: 9,
            circleColor: '#E8613D',
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 2.5,
          ),
        );
      }
      if (points.length > 1) {
        await map.addLine(
          LineOptions(
            geometry: points,
            lineColor: '#0B6E99',
            lineWidth: 5,
            lineOpacity: 0.8,
            lineJoin: 'round',
          ),
        );
      }
      final focus = points.isNotEmpty
          ? points
          : <LatLng>[?_origin, ?_destination];
      if (focus.isNotEmpty) await _fit(map, focus);
    } catch (_) {
      _drawn = false;
    }
  }

  Future<void> _fit(MapLibreMapController map, List<LatLng> points) async {
    if (points.length == 1) {
      await map.animateCamera(
        CameraUpdate.newLatLngZoom(points.first, 15),
        duration: const Duration(milliseconds: 450),
      );
      return;
    }
    var south = points.first.latitude;
    var north = points.first.latitude;
    var west = points.first.longitude;
    var east = points.first.longitude;
    for (final point in points.skip(1)) {
      south = point.latitude < south ? point.latitude : south;
      north = point.latitude > north ? point.latitude : north;
      west = point.longitude < west ? point.longitude : west;
      east = point.longitude > east ? point.longitude : east;
    }
    await map.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(south, west),
          northeast: LatLng(north, east),
        ),
        left: 44,
        right: 44,
        top: 44,
        bottom: 44,
      ),
      duration: const Duration(milliseconds: 450),
    );
  }

  List<Map<String, dynamic>> get _maneuvers {
    final maneuvers = <Map<String, dynamic>>[];
    for (final leg in asList(_route?['legs'])) {
      maneuvers.addAll(asList(asMap(leg)['maneuvers']));
    }
    return maneuvers;
  }

  String? get _firstInstruction {
    final maneuvers = _maneuvers;
    if (maneuvers.isEmpty) return null;
    return maneuvers.first['instruction']?.toString();
  }

  void _showSteps() {
    final maneuvers = _maneuvers;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: maneuvers.isEmpty
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Route steps are not available yet.'),
              )
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                itemCount: maneuvers.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final step = maneuvers[index];
                  final meters =
                      (step['distanceMeters'] as num?)?.toDouble() ?? 0;
                  final distance = meters < 1000
                      ? '${meters.round()} m'
                      : '${(meters / 1000).toStringAsFixed(1)} km';
                  return ListTile(
                    leading: CircleAvatar(
                      radius: 15,
                      child: Text('${index + 1}'),
                    ),
                    title: Text(
                      step['instruction']?.toString().isNotEmpty == true
                          ? step['instruction'].toString()
                          : 'Continue',
                    ),
                    subtitle: Text(distance),
                  );
                },
              ),
      ),
    );
  }

  String get _distanceLabel {
    final meters = (_route?['distanceMeters'] as num?)?.toDouble();
    if (meters == null) return 'Route unavailable';
    if (meters < 1000) return '${meters.round()} m';
    return '${(meters / 1000).toStringAsFixed(1)} km';
  }

  String get _durationLabel {
    final seconds = (_route?['durationSeconds'] as num?)?.toInt();
    if (seconds == null) return 'Check connection';
    final minutes = (seconds / 60).ceil();
    return '$minutes min';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final center = _destination ?? const LatLng(8.9806, 38.7578);
    return Scaffold(
      appBar: AppBar(
        title: Text('Navigate to ${widget.title}'),
        actions: [
          IconButton(
            tooltip: 'Route steps',
            onPressed: _maneuvers.isEmpty ? null : _showSteps,
            icon: const Icon(Icons.format_list_numbered_rounded),
          ),
          IconButton(
            tooltip: 'Recalculate route',
            onPressed: _loading ? null : _prepare,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: Stack(
        children: [
          MapLibreMap(
            styleString: _styleUrl,
            initialCameraPosition: CameraPosition(target: center, zoom: 14),
            onMapCreated: (controller) => _map = controller,
            onStyleLoadedCallback: () {
              _styleReady = true;
              _drawn = false;
              _draw();
            },
          ),
          if (_loading)
            const Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: LinearProgressIndicator(minHeight: 3),
            ),
          Positioned(
            left: 12,
            right: 12,
            bottom: 16,
            child: Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.route_rounded,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _distanceLabel,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        Text(
                          _durationLabel,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                      ],
                    ),
                    if (_firstInstruction != null) ...[
                      const SizedBox(height: 6),
                      Text(_firstInstruction!),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        _error!,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.error,
                        ),
                      ),
                    ],
                    if (_origin == null && !_loading) ...[
                      const SizedBox(height: 8),
                      Text(
                        'Current location is unavailable. Enable location access to calculate a route.',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: const Color(0xFFB26A00),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
