import 'dart:async';

import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../main.dart';

class AddressLocation {
  const AddressLocation({
    required this.latitude,
    required this.longitude,
    required this.addressLine,
  });

  final double latitude;
  final double longitude;
  final String addressLine;
}

class AddressMapPickerScreen extends StatefulWidget {
  const AddressMapPickerScreen({
    super.key,
    required this.client,
    this.initialLatitude,
    this.initialLongitude,
    this.initialAddress,
  });

  final ApiClient client;
  final double? initialLatitude;
  final double? initialLongitude;
  final String? initialAddress;

  @override
  State<AddressMapPickerScreen> createState() => _AddressMapPickerScreenState();
}

class _AddressMapPickerScreenState extends State<AddressMapPickerScreen> {
  static const _addisAbaba = LatLng(9.0110, 38.7865);

  final search = TextEditingController();
  Timer? _debounce;
  MapLibreMapController? _map;
  LatLng? _selected;
  String? _address;
  String? _error;
  String _styleUrl = _absoluteStyle('/api/v1/maps/styles/hybrid/style.json');
  List<Map<String, dynamic>> _results = const [];
  bool _styleReady = false;
  bool _searching = false;
  bool _resolving = false;
  int _searchGeneration = 0;

  @override
  void initState() {
    super.initState();
    _selected = widget.initialLatitude != null && widget.initialLongitude != null
        ? LatLng(widget.initialLatitude!, widget.initialLongitude!)
        : null;
    _address = widget.initialAddress?.trim();
    if (_selected == null && (_address ?? '').isNotEmpty) {
      search.text = _address!;
      _lookupAddress();
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    search.dispose();
    super.dispose();
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

  Future<void> _loadStyle() async {
    try {
      final config = asMap(await widget.client.get('/v1/maps/config'));
      final defaultStyle = config['defaultStyle']?.toString() ?? 'hybrid';
      final styles = asMap(config['styleUrls']);
      final path =
          styles[defaultStyle]?.toString() ??
          '/api/v1/maps/styles/hybrid/style.json';
      if (!mounted) return;
      setState(() => _styleUrl = _absoluteStyle(path));
    } catch (_) {
      // The bundled hybrid style stays available when configuration fails.
    }
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      _search(value);
    });
  }

  Future<void> _lookupAddress() async {
    final value = search.text.trim();
    if (value.isEmpty) return;
    final rows = await _search(value);
    if (!mounted || rows.isEmpty) return;
    final first = asMap(rows.first);
    final latitude = (first['latitude'] as num?)?.toDouble();
    final longitude = (first['longitude'] as num?)?.toDouble();
    if (latitude == null || longitude == null) return;
    _select(
      LatLng(latitude, longitude),
      address: first['formattedAddress']?.toString(),
    );
  }

  Future<List<Map<String, dynamic>>> _search(String value) async {
    final query = value.trim();
    if (query.length < 3) {
      if (mounted) setState(() => _results = const []);
      return const [];
    }
    final generation = ++_searchGeneration;
    if (mounted) setState(() => _searching = true);
    try {
      final result = asMap(
        await widget.client.get(
          '/v1/maps/search?q=${Uri.encodeQueryComponent(query)}&limit=5',
        ),
      );
      final rows = asList(result['results']);
      if (mounted && generation == _searchGeneration) {
        setState(() {
          _results = rows;
          _error = null;
        });
      }
      return rows;
    } catch (cause) {
      if (mounted && generation == _searchGeneration) {
        setState(() {
          _results = const [];
          _error = cause.toString().replaceFirst('Exception: ', '');
        });
      }
      return const [];
    } finally {
      if (mounted && generation == _searchGeneration) {
        setState(() => _searching = false);
      }
    }
  }

  Future<void> _select(LatLng point, {String? address}) async {
    if (mounted) {
      setState(() {
        _selected = point;
        _address = address;
        _results = const [];
        _error = null;
        _resolving = address == null;
      });
    }
    FocusScope.of(context).unfocus();
    await _map?.animateCamera(
      CameraUpdate.newLatLngZoom(point, 17),
      duration: const Duration(milliseconds: 400),
    );
    await _drawPin();
    if (address != null) return;
    try {
      final result = asMap(
        await widget.client.get(
          '/v1/maps/reverse?latitude=${point.latitude}&longitude=${point.longitude}',
        ),
      );
      final place = asMap(result['result']);
      final formatted = place['formattedAddress']?.toString();
      if (mounted) {
        setState(() {
          _address = formatted;
          _resolving = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Could not resolve this point to an address. You can still use it.';
          _resolving = false;
        });
      }
    }
  }

  Future<void> _drawPin() async {
    final map = _map;
    final point = _selected;
    if (!_styleReady || map == null) return;
    try {
      await map.clearCircles();
      if (point == null) return;
      await map.addCircle(
        CircleOptions(
          geometry: point,
          circleRadius: 10,
          circleColor: '#E8613D',
          circleStrokeColor: '#FFFFFF',
          circleStrokeWidth: 3,
        ),
      );
    } catch (_) {
      // The next style load redraws the pin.
    }
  }

  void _useLocation() {
    final point = _selected;
    if (point == null) return;
    Navigator.pop(
      context,
      AddressLocation(
        latitude: point.latitude,
        longitude: point.longitude,
        addressLine: (_address ?? '').trim().isEmpty
            ? '${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)}'
            : _address!.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final center = _selected ?? _addisAbaba;
    return Scaffold(
      appBar: AppBar(title: const Text('Pin delivery location')),
      body: Stack(
        children: [
          MapLibreMap(
            styleString: _styleUrl,
            initialCameraPosition: CameraPosition(target: center, zoom: 15),
            onMapCreated: (controller) {
              _map = controller;
              _loadStyle();
            },
            onStyleLoadedCallback: () {
              _styleReady = true;
              _drawPin();
            },
            onMapClick: (_, coordinates) => _select(coordinates),
          ),
          Positioned(
            left: 12,
            right: 12,
            top: 12,
            child: Material(
              elevation: 5,
              borderRadius: BorderRadius.circular(16),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: search,
                      textInputAction: TextInputAction.search,
                      onChanged: _onSearchChanged,
                      onSubmitted: (_) => _lookupAddress(),
                      decoration: InputDecoration(
                        border: InputBorder.none,
                        prefixIcon: const Icon(Icons.search_rounded),
                        hintText: 'Search building, street or landmark',
                        suffixIcon: _searching
                            ? const Padding(
                                padding: EdgeInsets.all(14),
                                child: SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                ),
                              )
                            : null,
                      ),
                    ),
                    if (_results.isNotEmpty)
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 240),
                        child: ListView.separated(
                          shrinkWrap: true,
                          itemCount: _results.length,
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (context, index) {
                            final row = _results[index];
                            final latitude = (row['latitude'] as num?)?.toDouble();
                            final longitude = (row['longitude'] as num?)?.toDouble();
                            return ListTile(
                              dense: true,
                              leading: const Icon(Icons.place_outlined),
                              title: Text(
                                row['formattedAddress']?.toString() ?? 'Unnamed place',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              onTap: latitude == null || longitude == null
                                  ? null
                                  : () => _select(
                                      LatLng(latitude, longitude),
                                      address: row['formattedAddress']?.toString(),
                                    ),
                            );
                          },
                        ),
                      ),
                  ],
                ),
              ),
            ),
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
                    Text(
                      'Tap the map or search to position the exact delivery point.',
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.location_on_rounded,
                          size: 18,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _resolving
                                ? 'Finding address…'
                                : (_address?.isNotEmpty == true
                                      ? _address!
                                      : 'No location selected yet.'),
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (_selected != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        '${_selected!.latitude.toStringAsFixed(5)}, ${_selected!.longitude.toStringAsFixed(5)}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        _error!,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.error,
                        ),
                      ),
                    ],
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _selected == null || _resolving
                            ? null
                            : _useLocation,
                        icon: const Icon(Icons.check_rounded),
                        label: const Text('Use this location'),
                      ),
                    ),
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
