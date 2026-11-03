import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:url_launcher/url_launcher.dart';

import 'main.dart';

/// Delivery execution surface for one assigned order.
///
/// The API returns the authoritative `allowedActions` list for the current
/// assignment. The UI mirrors the same rules offline so an impossible step can
/// never be queued, and every submit is still validated again by the server.
class DeliveryExecutionScreen extends StatefulWidget {
  const DeliveryExecutionScreen({
    super.key,
    required this.client,
    required this.orderId,
    this.initial,
  });

  final ApiClient client;
  final String orderId;
  final Map<String, dynamic>? initial;

  @override
  State<DeliveryExecutionScreen> createState() =>
      _DeliveryExecutionScreenState();
}

class _DeliveryExecutionScreenState extends State<DeliveryExecutionScreen> {
  Map<String, dynamic>? _detail;
  bool _loading = true;
  bool _busy = false;
  bool _hasQueuedChanges = false;
  String? _error;

  Map<String, dynamic> get _delivery =>
      asMap(_detail?['delivery'] ?? widget.initial);

  List<String> get _allowed {
    if (_detail == null) return _fallbackAllowedActions(_delivery);
    return ((_detail!['allowedActions'] as List?) ?? const [])
        .map((action) => action.toString())
        .toList();
  }

  bool _can(String action) => _allowed.contains(action);

  @override
  void initState() {
    super.initState();
    widget.client.pendingSync.addListener(_onSyncChanged);
    widget.client.connected.addListener(_onSyncChanged);
    _load();
  }

  @override
  void dispose() {
    widget.client.pendingSync.removeListener(_onSyncChanged);
    widget.client.connected.removeListener(_onSyncChanged);
    super.dispose();
  }

  void _onSyncChanged() {
    if (!mounted) return;
    if (widget.client.pendingSync.value == 0 && _hasQueuedChanges) {
      _hasQueuedChanges = false;
      unawaited(_load());
    }
    setState(() {});
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final result = asMap(
        await widget.client.get('/v1/courier/deliveries/${widget.orderId}'),
      );
      if (!mounted) return;
      setState(() {
        _detail = result;
        _loading = false;
      });
    } on ApiException catch (cause) {
      if (!mounted) return;
      setState(() {
        _error = cause.message;
        _loading = false;
      });
    } catch (cause) {
      if (!mounted) return;
      setState(() {
        _error = cause.toString();
        _loading = false;
      });
    }
  }

  Future<bool> _submit(
    String action, {
    Map<String, Object?> body = const <String, Object?>{},
  }) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.client.postQueued(
        '/v1/courier/deliveries/${widget.orderId}/$action',
        body,
      );
      final queued = result is Map && result['queued'] == true;
      if (!mounted) return true;
      if (queued) {
        _hasQueuedChanges = true;
        await _applyQueuedAction(action, body);
        if (widget.client.pendingSync.value == 0) {
          _hasQueuedChanges = false;
          await _load();
        }
      }
      if (!mounted) return true;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            queued
                ? 'Saved offline. It will sync when you are back online.'
                : 'Delivery updated: ${_actionLabel(action)}.',
          ),
        ),
      );
      if (!queued) await _load();
      return true;
    } on ApiException catch (cause) {
      if (cause.statusCode == 404 || cause.statusCode == 409) await _load();
      if (!mounted) return false;
      setState(() => _error = cause.message);
      return false;
    } catch (cause) {
      if (!mounted) return false;
      setState(() => _error = cause.toString());
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _applyQueuedAction(
    String action,
    Map<String, Object?> body,
  ) async {
    final delivery = Map<String, dynamic>.from(_delivery);
    var allowedActions = <String>[];
    switch (action) {
      case 'arrived_pickup':
        delivery['assignmentStatus'] = 'arrived_pickup';
        delivery['orderStatus'] = 'COURIER_ARRIVING_PICKUP';
        allowedActions = ['picked_up', 'failed'];
      case 'picked_up':
        delivery['assignmentStatus'] = 'picked_up';
        delivery['orderStatus'] = 'PICKED_UP';
        allowedActions = ['in_transit', 'failed'];
      case 'in_transit':
        delivery['orderStatus'] = 'IN_TRANSIT';
        allowedActions = ['delivered', 'failed'];
      case 'delivered':
        delivery['assignmentStatus'] = 'delivered';
        delivery['orderStatus'] = 'DELIVERED';
      case 'failed':
        final returnRequired = body['returnRequired'] == true;
        delivery['assignmentStatus'] = 'failed';
        delivery['orderStatus'] = 'FAILED';
        delivery['failure'] = {
          'reasonCode': body['failureReason'],
          'notes': body['notes'],
          'returnRequired': returnRequired,
          'returnStatus': returnRequired ? 'pending' : 'not_required',
        };
        if (returnRequired) allowedActions = ['returned'];
      case 'returned':
        final failure = Map<String, dynamic>.from(asMap(delivery['failure']));
        delivery['failure'] = {...failure, 'returnStatus': 'completed'};
      default:
        return;
    }
    final detail = {
      ...?_detail,
      'delivery': delivery,
      'allowedActions': allowedActions,
    };
    setState(() {
      _detail = detail;
      _loading = false;
    });
    await widget.client.storage.cacheResponse(
      '/v1/courier/deliveries/${widget.orderId}',
      detail,
    );
  }

  Future<bool> _confirm({
    required String title,
    required String message,
    required String confirmLabel,
    bool destructive = false,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: destructive
                ? FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFA63A32),
                  )
                : null,
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return confirmed == true;
  }

  Future<void> _handlePrimary() async {
    final action = _primaryAction();
    if (action == null || _busy) return;
    switch (action) {
      case 'arrived_pickup':
        if (!await _confirm(
          title: 'Arrived at merchant',
          message:
              'Confirm you are at ${_delivery['merchantName'] ?? 'the merchant'} and ready to collect the order.',
          confirmLabel: 'Confirm arrival',
        )) {
          return;
        }
        await _submit('arrived_pickup');
      case 'picked_up':
        if (!await _confirm(
          title: 'Confirm package handoff',
          message:
              'Confirm the merchant handed over the sealed package and the items match the order before you leave.',
          confirmLabel: 'Confirm pickup',
        )) {
          return;
        }
        await _submit('picked_up', body: {'notes': 'Package handed over by merchant'});
      case 'in_transit':
        if (!await _confirm(
          title: 'Start delivery',
          message:
              'The customer will be told you are on the way. Drive safely and follow the delivery instructions.',
          confirmLabel: 'Start delivery',
        )) {
          return;
        }
        await _submit('in_transit');
      case 'delivered':
        await _completeDelivery();
      case 'returned':
        if (!await _confirm(
          title: 'Confirm merchant return',
          message:
              'Confirm the goods were handed back to the merchant and the return is complete.',
          confirmLabel: 'Confirm return',
        )) {
          return;
        }
        if (await _submit('returned')) _close();
    }
  }

  Future<void> _completeDelivery() async {
    final delivery = _delivery;
    final result = await showModalBottomSheet<Map<String, Object?>>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => _ProofSheet(delivery: delivery),
    );
    if (result == null) return;
    final submitted = await _submit('delivered', body: result);
    if (submitted && mounted) _close();
  }

  Future<void> _reportFailure() async {
    final delivery = _delivery;
    final result = await showModalBottomSheet<Map<String, Object?>>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => _FailureSheet(delivery: delivery),
    );
    if (result == null) return;
    final submitted = await _submit('failed', body: result);
    if (submitted && mounted) _close();
  }

  void _close() {
    Navigator.of(context).pop(true);
  }

  String? _primaryAction() {
    for (final action in const [
      'arrived_pickup',
      'picked_up',
      'in_transit',
      'delivered',
      'returned',
    ]) {
      if (_can(action)) return action;
    }
    return null;
  }

  String _actionLabel(String action) {
    switch (action) {
      case 'arrived_pickup':
        return 'Arrived at pickup';
      case 'picked_up':
        return 'Package picked up';
      case 'in_transit':
        return 'En route';
      case 'delivered':
        return 'Delivered';
      case 'failed':
        return 'Delivery failed';
      case 'returned':
        return 'Returned to merchant';
      default:
        return label(action);
    }
  }

  /// Mirrors the shared domain rules. Only used before the detail response
  /// arrives; the server list always wins once loaded.
  List<String> _fallbackAllowedActions(Map<String, dynamic> delivery) {
    final assignment = delivery['assignmentStatus']?.toString() ?? '';
    final order = delivery['orderStatus']?.toString() ?? '';
    final failure = asMap(delivery['failure']);
    switch (assignment) {
      case 'accepted':
        return order == 'COURIER_ASSIGNED'
            ? const ['arrived_pickup', 'failed']
            : const ['failed'];
      case 'arrived_pickup':
        return order == 'COURIER_ARRIVING_PICKUP'
            ? const ['picked_up', 'failed']
            : const ['failed'];
      case 'picked_up':
        return order == 'IN_TRANSIT'
            ? const ['delivered', 'failed']
            : const ['in_transit', 'failed'];
      case 'failed':
        return failure['returnRequired'] == true &&
                failure['returnStatus'] == 'pending'
            ? const ['returned']
            : const <String>[];
      default:
        return const <String>[];
    }
  }

  String? _cleanPhone(Object? value) {
    final raw = value?.toString().trim() ?? '';
    if (raw.isEmpty) return null;
    if (!RegExp(r'^\+?[0-9][0-9 ()-]{6,20}$').hasMatch(raw)) return null;
    return raw.replaceAll(RegExp(r'[^+0-9]'), '');
  }

  Future<void> _openUri(Uri uri, String failureMessage) async {
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        return;
      }
    } catch (_) {
      // Fall through to the user-facing message below.
    }
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(failureMessage)));
    }
  }

  Future<void> _call(Object? phoneValue) async {
    final phone = _cleanPhone(phoneValue);
    if (phone == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No permitted phone number is available.')),
      );
      return;
    }
    await _openUri(
      Uri(scheme: 'tel', path: phone),
      'Calling is not available on this device.',
    );
  }

  Future<void> _message(Object? phoneValue, String orderNumber) async {
    final phone = _cleanPhone(phoneValue);
    if (phone == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No permitted phone number is available.')),
      );
      return;
    }
    final body =
        'Hello, this is your courier for order $orderNumber. I am on my way.';
    await _openUri(
      Uri(
        scheme: 'sms',
        path: phone,
        queryParameters: <String, String>{'body': body},
      ),
      'Messaging is not available on this device.',
    );
  }

  Future<void> _navigate(Map<String, dynamic> stop, String fallbackName) async {
    final latitude = (stop['latitude'] as num?)?.toDouble();
    final longitude = (stop['longitude'] as num?)?.toDouble();
    final address = (stop['address']?.toString() ?? '').trim();
    if (latitude == null || longitude == null) {
      if (address.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$fallbackName has no map location yet.')),
        );
        return;
      }
      await _openUri(
        Uri.parse(
          'https://www.google.com/maps/dir/?api=1&destination=${Uri.encodeComponent(address)}',
        ),
        'No navigation app is available on this device.',
      );
      return;
    }
    final geo = Uri.parse('geo:$latitude,$longitude?q=$latitude,$longitude');
    try {
      if (await canLaunchUrl(geo)) {
        await launchUrl(geo, mode: LaunchMode.externalApplication);
        return;
      }
    } catch (_) {
      // Fall back to the universal maps link.
    }
    await _openUri(
      Uri.parse(
        'https://www.google.com/maps/dir/?api=1&destination=$latitude,$longitude&travelmode=two_wheeler',
      ),
      'No navigation app is available on this device.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final delivery = _delivery;
    final orderNumber = delivery['orderNumber']?.toString() ?? 'Delivery';
    final assignment = delivery['assignmentStatus']?.toString() ?? '';
    final pendingReturn =
        asMap(delivery['failure'])['returnStatus'] == 'pending' &&
        asMap(delivery['failure'])['returnRequired'] == true;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(orderNumber),
            Text(
              label(assignment),
              style: const TextStyle(
                fontSize: 12,
                color: Color(0xFF6B7468),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh delivery',
            onPressed: _busy ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading && _detail == null && widget.initial == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 32),
                children: [
                  if (widget.client.pendingSync.value > 0 ||
                      !widget.client.connected.value)
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF3D8),
                        border: Border.all(color: const Color(0xFFE7D3A4)),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.sync, size: 18, color: Color(0xFF8A5A00)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              !widget.client.connected.value
                                  ? 'Offline${widget.client.pendingSync.value > 0 ? ' · ${widget.client.pendingSync.value} updates pending' : '; saved delivery data available'}'
                                  : '${widget.client.pendingSync.value} update${widget.client.pendingSync.value == 1 ? '' : 's'} waiting for server confirmation',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                          ),
                          if (widget.client.pendingSync.value > 0)
                            IconButton(
                              tooltip: 'Sync pending updates',
                              onPressed: () => unawaited(widget.client.flushQueue()),
                              icon: const Icon(Icons.cloud_upload_outlined),
                            ),
                        ],
                      ),
                    ),
                  if (_error != null) ...[
                    ErrorBanner(message: _error!),
                    const SizedBox(height: 12),
                  ],
                  _progressCard(theme, delivery),
                  const SizedBox(height: 12),
                  if (pendingReturn) ...[
                    _pendingReturnCard(theme, delivery),
                    const SizedBox(height: 12),
                  ],
                  _stopsCard(theme, delivery),
                  const SizedBox(height: 12),
                  if ((delivery['deliveryInstructions']?.toString() ?? '')
                      .isNotEmpty)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Icon(
                                  Icons.sticky_note_2_outlined,
                                  size: 18,
                                  color: Color(0xFFB26A00),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  'Delivery instructions',
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              delivery['deliveryInstructions'].toString(),
                              style: const TextStyle(height: 1.45),
                            ),
                          ],
                        ),
                      ),
                    ),
                  if ((delivery['deliveryInstructions']?.toString() ?? '')
                      .isNotEmpty)
                    const SizedBox(height: 12),
                  _proofExpectationCard(theme, delivery),
                  const SizedBox(height: 12),
                  _actionsCard(theme, delivery),
                  const SizedBox(height: 12),
                  _timelineCard(theme, delivery),
                  if (_detail != null) ...[
                    const SizedBox(height: 12),
                    _eventTimeline(theme),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _progressCard(ThemeData theme, Map<String, dynamic> delivery) {
    final assignment = delivery['assignmentStatus']?.toString() ?? '';
    final order = delivery['orderStatus']?.toString() ?? '';
    final arrived =
        delivery['arrivedAt'] != null ||
        delivery['pickedUpAt'] != null ||
        delivery['deliveredAt'] != null ||
        assignment == 'arrived_pickup' ||
        assignment == 'picked_up' ||
        assignment == 'delivered';
    final picked =
        delivery['pickedUpAt'] != null ||
        assignment == 'picked_up' ||
        assignment == 'delivered';
    final inTransit = order == 'IN_TRANSIT' || order == 'DELIVERED';
    final delivered = assignment == 'delivered' || order == 'DELIVERED';
    final steps = <(String, bool)>[
      ('Accepted', true),
      ('At merchant', arrived),
      ('Picked up', picked),
      ('En route', inTransit),
      ('Delivered', delivered),
    ];
    return Container(
      padding: const EdgeInsets.all(18),
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
                      'CURRENT STEP',
                      style: TextStyle(
                        color: Color(0xFF98A59A),
                        fontSize: 10,
                        letterSpacing: 1.4,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _currentStepLabel(delivery),
                      style: theme.textTheme.titleLarge?.copyWith(
                        color: const Color(0xFFEEF0E6),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                money(
                  delivery['courierEarningMinor'] as num?,
                  delivery['currency']?.toString(),
                ),
                style: const TextStyle(
                  color: Color(0xFFEEF0E6),
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              for (var i = 0; i < steps.length; i++)
                Expanded(
                  child: Column(
                    children: [
                      Container(
                        height: 4,
                        margin: EdgeInsets.only(right: i == steps.length - 1 ? 0 : 4),
                        decoration: BoxDecoration(
                          color: steps[i].$2
                              ? const Color(0xFF88C9A3)
                              : const Color(0xFF38453D),
                          borderRadius: BorderRadius.circular(99),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        steps[i].$1,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: steps[i].$2
                              ? const Color(0xFFCFE3D6)
                              : const Color(0xFF7C8A80),
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  String _currentStepLabel(Map<String, dynamic> delivery) {
    final assignment = delivery['assignmentStatus']?.toString() ?? '';
    final order = delivery['orderStatus']?.toString() ?? '';
    if (assignment == 'delivered' || order == 'DELIVERED') {
      return 'Delivered';
    }
    if (assignment == 'failed') return 'Delivery failed';
    if (order == 'IN_TRANSIT') return 'En route to customer';
    if (assignment == 'picked_up') return 'Package collected';
    if (assignment == 'arrived_pickup') return 'At the merchant';
    return 'Heading to pickup';
  }

  Widget _pendingReturnCard(ThemeData theme, Map<String, dynamic> delivery) {
    final failure = asMap(delivery['failure']);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4E5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEBCFA6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.assignment_return_outlined, color: Color(0xFFB26A00)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Return to merchant pending',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: const Color(0xFF8A5200),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${failure['reasonLabel'] ?? 'Delivery failed'}. Hand the goods back to ${delivery['merchantName'] ?? 'the merchant'} and confirm the return.',
            style: const TextStyle(fontSize: 13, height: 1.4),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _busy ? null : _handlePrimary,
            icon: const Icon(Icons.check, size: 18),
            label: const Text('Confirm return to merchant'),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF8A5200),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stopsCard(ThemeData theme, Map<String, dynamic> delivery) {
    final pickup = asMap(delivery['pickup']);
    final dropoff = asMap(delivery['dropoff']);
    final orderNumber = delivery['orderNumber']?.toString() ?? 'delivery';
    final dropped = delivery['assignmentStatus'] == 'delivered';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _stopRow(
              icon: Icons.storefront,
              title: 'PICKUP',
              name: pickup['name']?.toString().isNotEmpty == true
                  ? pickup['name'].toString()
                  : delivery['merchantName']?.toString() ?? 'Merchant',
              address: pickup['address']?.toString() ??
                  delivery['pickupAddress']?.toString(),
              contact: pickup['contactName']?.toString(),
              phone: pickup['contactPhone'],
              orderNumber: orderNumber,
              onNavigate: () => _navigate(pickup, 'Merchant'),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 10),
              child: Divider(height: 1),
            ),
            _stopRow(
              icon: Icons.location_on_outlined,
              title: 'DROP-OFF',
              name: dropoff['name']?.toString().isNotEmpty == true
                  ? dropoff['name'].toString()
                  : delivery['customerName']?.toString() ?? 'Customer',
              address: dropoff['address']?.toString() ??
                  delivery['deliveryAddress']?.toString(),
              contact: dropoff['contactName']?.toString(),
              phone: dropoff['contactPhone'] ?? delivery['customerPhone'],
              orderNumber: orderNumber,
              onNavigate: () => _navigate(dropoff, 'Customer'),
              disabled: dropped,
            ),
          ],
        ),
      ),
    );
  }

  Widget _stopRow({
    required IconData icon,
    required String title,
    required String name,
    String? address,
    String? contact,
    Object? phone,
    required String orderNumber,
    required VoidCallback onNavigate,
    bool disabled = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: const Color(0xFF2F6B4F)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 10,
                      color: Color(0xFF6B7468),
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.8,
                    ),
                  ),
                  Text(
                    name,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  if (contact != null && contact.isNotEmpty)
                    Text(
                      contact,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF6B7468),
                      ),
                    ),
                  if (address != null && address.isNotEmpty)
                    Text(
                      address,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF6B7468),
                        height: 1.35,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: disabled ? null : onNavigate,
              icon: const Icon(Icons.navigation_outlined, size: 16),
              label: const Text('Navigate'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 38),
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
            OutlinedButton.icon(
              onPressed: disabled ? null : () => _call(phone),
              icon: const Icon(Icons.call_outlined, size: 16),
              label: const Text('Call'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 38),
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
            OutlinedButton.icon(
              onPressed: disabled
                  ? null
                  : () => _message(phone, orderNumber),
              icon: const Icon(Icons.sms_outlined, size: 16),
              label: const Text('Message'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 38),
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _proofExpectationCard(ThemeData theme, Map<String, dynamic> delivery) {
    if (_delivery['assignmentStatus'] == 'delivered') {
      return const SizedBox.shrink();
    }
    final mode = delivery['deliveryProofMode']?.toString() ?? 'handoff';
    final (icon, text) = switch (mode) {
      'otp' => (
        Icons.pin_outlined,
        'Ask the customer for their delivery code before completing the delivery.',
      ),
      'qr' => (
        Icons.qr_code_scanner,
        'Scan the customer delivery QR code before completing the delivery.',
      ),
      'photo' => (
        Icons.camera_alt_outlined,
        'Capture a delivery photo at the drop-off before completing the delivery.',
      ),
      'signature' => (
        Icons.draw_outlined,
        'Collect the recipient signature before completing the delivery.',
      ),
      _ => (
        Icons.handshake_outlined,
        'Confirm the package was handed to the right person.',
      ),
    };
    return Card(
      child: ListTile(
        leading: Icon(icon, color: const Color(0xFF2F6B4F)),
        title: Text(
          'Proof of delivery',
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Text(text, style: const TextStyle(height: 1.4)),
      ),
    );
  }

  Widget _actionsCard(ThemeData theme, Map<String, dynamic> delivery) {
    final primary = _primaryAction();
    final canFail = _can('failed');
    final failure = asMap(delivery['failure']);
    final closed = _allowed.isEmpty;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_busy)
              const Padding(
                padding: EdgeInsets.only(bottom: 10),
                child: LinearProgressIndicator(minHeight: 2),
              ),
            if (primary != null)
              FilledButton.icon(
                onPressed: _busy ? null : _handlePrimary,
                icon: Icon(_actionIcon(primary)),
                label: Text(_actionLabel(primary)),
              ),
            if (canFail)
              Padding(
                padding: EdgeInsets.only(top: primary == null ? 0 : 8),
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _reportFailure,
                  icon: const Icon(Icons.report_gmailerrorred_outlined),
                  label: const Text('Report a problem'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFA63A32),
                    side: const BorderSide(color: Color(0xFFEFC7C1)),
                  ),
                ),
              ),
            if (closed && failure['reasonCode'] == null)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'This delivery has no remaining courier actions.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF6B7468), fontSize: 13),
                ),
              ),
            if (failure['reasonCode'] != null) ...[
              const Divider(height: 24),
              Text(
                'Reported: ${failure['reasonLabel'] ?? label(failure['reasonCode']?.toString())}',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  color: Color(0xFFA63A32),
                  fontSize: 13,
                ),
              ),
              if ((failure['notes']?.toString() ?? '').isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    failure['notes'].toString(),
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF6B7468),
                    ),
                  ),
                ),
            ],
            const SizedBox(height: 8),
            Text(
              'Status updates are validated by the server. Offline updates are saved and replayed in order.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: const Color(0xFF8B9188),
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _actionIcon(String action) {
    switch (action) {
      case 'arrived_pickup':
        return Icons.location_on_outlined;
      case 'picked_up':
        return Icons.inventory_2_outlined;
      case 'in_transit':
        return Icons.two_wheeler;
      case 'delivered':
        return Icons.task_alt;
      case 'returned':
        return Icons.keyboard_return;
      default:
        return Icons.arrow_forward;
    }
  }

  Widget _timelineCard(ThemeData theme, Map<String, dynamic> delivery) {
    final rows = <(String, Object?, IconData)>[
      ('Accepted', delivery['acceptedAt'], Icons.assignment_turned_in_outlined),
      ('At merchant', delivery['arrivedAt'], Icons.storefront),
      ('Picked up', delivery['pickedUpAt'], Icons.inventory_2_outlined),
      ('Delivered', delivery['deliveredAt'], Icons.task_alt),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Delivery timeline',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 10),
            for (final row in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Icon(
                      row.$2 == null ? row.$3 : Icons.check_circle,
                      size: 17,
                      color: row.$2 == null
                          ? const Color(0xFFB9BDB4)
                          : const Color(0xFF2F6B4F),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 96,
                      child: Text(
                        row.$1,
                        style: TextStyle(
                          fontSize: 12,
                          color: row.$2 == null
                              ? const Color(0xFF9AA096)
                              : const Color(0xFF20261F),
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        row.$2 == null ? 'Pending' : shortDate(row.$2.toString()),
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF6B7468),
                        ),
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

  Widget _eventTimeline(ThemeData theme) {
    final events = (_detail!['timeline'] as List?) ?? const [];
    if (events.isEmpty) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Activity',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            for (final raw in events.reversed.take(6))
              Builder(
                builder: (_) {
                  final event = asMap(raw);
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.circle,
                          size: 7,
                          color: Color(0xFF88C9A3),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            '${label(event['toStatus']?.toString())}'
                            '${(event['note']?.toString() ?? '').isEmpty ? '' : ' · ${event['note']}'}'
                            '\n${shortDate(event['at']?.toString())}',
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF6B7468),
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Proof of delivery
// ---------------------------------------------------------------------------

class _ProofSheet extends StatefulWidget {
  const _ProofSheet({required this.delivery});

  final Map<String, dynamic> delivery;

  @override
  State<_ProofSheet> createState() => _ProofSheetState();
}

class _ProofSheetState extends State<_ProofSheet> {
  final _otpController = TextEditingController();
  final _qrController = TextEditingController();
  final _recipientController = TextEditingController();
  final _notesController = TextEditingController();
  final _signature = _SignatureModel();
  final _picker = ImagePicker();

  String? _photoDataUrl;
  String? _error;
  bool _capturing = false;

  String get _mode =>
      widget.delivery['deliveryProofMode']?.toString() ?? 'handoff';

  @override
  void dispose() {
    _otpController.dispose();
    _qrController.dispose();
    _recipientController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _scanQr() async {
    final payload = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _QrScanScreen()),
    );
    if (payload != null && payload.isNotEmpty && mounted) {
      setState(() {
        _qrController.text = payload;
        _error = null;
      });
    }
  }

  Future<void> _capturePhoto() async {
    setState(() {
      _capturing = true;
      _error = null;
    });
    try {
      final file = await _picker.pickImage(
        source: ImageSource.camera,
        maxWidth: 1080,
        imageQuality: 45,
        preferredCameraDevice: CameraDevice.rear,
      );
      if (file == null) return;
      final bytes = await file.readAsBytes();
      if (bytes.length > 480000) {
        setState(() => _error = 'The photo is too large. Retake it and try again.');
        return;
      }
      setState(() {
        _photoDataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';
      });
    } catch (cause) {
      if (mounted) setState(() => _error = 'Camera unavailable: $cause');
    } finally {
      if (mounted) setState(() => _capturing = false);
    }
  }

  Future<String?> _signatureDataUrl() async {
    if (_signature.isEmpty) return null;
    final picture = _signature.toPicture();
    final image = await picture.toImage(640, 240);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (data == null) return null;
    return 'data:image/png;base64,${base64Encode(data.buffer.asUint8List())}';
  }

  Future<void> _complete() async {
    final notes = _notesController.text.trim();
    final recipient = _recipientController.text.trim();
    Map<String, Object?>? body;
    switch (_mode) {
      case 'otp':
        final code = _otpController.text.trim();
        if (!RegExp(r'^\d{4,12}$').hasMatch(code)) {
          setState(() => _error = 'Enter the 4–12 digit delivery code.');
          return;
        }
        body = {'proofCode': code};
      case 'qr':
        final payload = _qrController.text.trim();
        if (payload.isEmpty) {
          setState(() => _error = 'Scan or enter the customer QR code.');
          return;
        }
        body = {'proofCode': payload};
      case 'photo':
        if (_photoDataUrl == null) {
          setState(() => _error = 'Capture a delivery photo first.');
          return;
        }
        body = {'proofStorageKey': _photoDataUrl};
      case 'signature':
        if (recipient.length < 2) {
          setState(() => _error = 'Enter the name of the person signing.');
          return;
        }
        final dataUrl = await _signatureDataUrl();
        if (dataUrl == null) {
          setState(() => _error = 'Collect the recipient signature first.');
          return;
        }
        body = {'proofStorageKey': dataUrl, 'recipientName': recipient};
      default:
        body = {
          if (recipient.isNotEmpty) 'recipientName': recipient,
        };
    }
    if (notes.isNotEmpty) body['notes'] = notes;
    if (!mounted) return;
    Navigator.of(context).pop(body);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 18, 20, 18 + bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Proof of delivery',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              _modeDescription(),
              style: const TextStyle(color: Color(0xFF6B7468), fontSize: 13),
            ),
            const SizedBox(height: 16),
            if (_mode == 'otp')
              TextField(
                controller: _otpController,
                autofocus: true,
                keyboardType: TextInputType.number,
                maxLength: 12,
                decoration: const InputDecoration(
                  labelText: 'Customer delivery code',
                  counterText: '',
                ),
              ),
            if (_mode == 'qr') ...[
              TextField(
                controller: _qrController,
                decoration: const InputDecoration(
                  labelText: 'QR payload',
                  hintText: 'Scan the customer QR code',
                ),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: _scanQr,
                icon: const Icon(Icons.qr_code_scanner),
                label: const Text('Scan QR code'),
              ),
            ],
            if (_mode == 'photo') ...[
              if (_photoDataUrl != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.memory(
                    base64Decode(_photoDataUrl!.split(',').last),
                    height: 160,
                    width: double.infinity,
                    fit: BoxFit.cover,
                  ),
                ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _capturing ? null : _capturePhoto,
                icon: const Icon(Icons.camera_alt_outlined),
                label: Text(
                  _capturing
                      ? 'Opening camera…'
                      : _photoDataUrl == null
                          ? 'Capture delivery photo'
                          : 'Retake photo',
                ),
              ),
            ],
            if (_mode == 'signature') ...[
              TextField(
                controller: _recipientController,
                decoration: const InputDecoration(
                  labelText: 'Recipient name',
                ),
              ),
              const SizedBox(height: 10),
              Container(
                height: 200,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFD9D5C7)),
                ),
                child: _SignaturePad(model: _signature),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Ask the recipient to sign above.',
                      style: TextStyle(fontSize: 12, color: Color(0xFF6B7468)),
                    ),
                  ),
                  TextButton(
                    onPressed: () => setState(_signature.clear),
                    child: const Text('Clear'),
                  ),
                ],
              ),
            ],
            if (_mode == 'handoff')
              TextField(
                controller: _recipientController,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Received by (optional)',
                ),
              ),
            const SizedBox(height: 10),
            TextField(
              controller: _notesController,
              maxLines: 2,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'Delivery notes (optional)',
                counterText: '',
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              ErrorBanner(message: _error!),
            ],
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _complete,
                icon: const Icon(Icons.verified_outlined),
                label: const Text('Verify and complete delivery'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _modeDescription() {
    switch (_mode) {
      case 'otp':
        return 'Enter the delivery code shown on the customer app.';
      case 'qr':
        return 'Scan the customer delivery QR code.';
      case 'photo':
        return 'Capture the package at the drop-off location.';
      case 'signature':
        return 'Collect a signature from the person receiving the package.';
      default:
        return 'Confirm the package was handed to the right person.';
    }
  }
}

class _FailureSheet extends StatefulWidget {
  const _FailureSheet({required this.delivery});

  final Map<String, dynamic> delivery;

  @override
  State<_FailureSheet> createState() => _FailureSheetState();
}

class _FailureSheetState extends State<_FailureSheet> {
  static const _reasons = <Map<String, Object>>[
    {
      'code': 'inaccessible_address',
      'label': 'Address inaccessible',
      'requiresReturn': true,
      'requiresNotes': false,
    },
    {
      'code': 'recipient_unavailable',
      'label': 'Recipient unavailable',
      'requiresReturn': true,
      'requiresNotes': false,
    },
    {
      'code': 'recipient_refused',
      'label': 'Recipient refused delivery',
      'requiresReturn': true,
      'requiresNotes': false,
    },
    {
      'code': 'damaged_goods',
      'label': 'Goods damaged',
      'requiresReturn': true,
      'requiresNotes': true,
    },
    {
      'code': 'order_not_ready',
      'label': 'Order not ready at pickup',
      'requiresReturn': false,
      'requiresNotes': false,
    },
    {
      'code': 'safety_concern',
      'label': 'Safety concern',
      'requiresReturn': true,
      'requiresNotes': true,
    },
    {
      'code': 'vehicle_issue',
      'label': 'Vehicle breakdown',
      'requiresReturn': false,
      'requiresNotes': false,
    },
    {
      'code': 'other',
      'label': 'Other',
      'requiresReturn': true,
      'requiresNotes': true,
    },
  ];

  final _notesController = TextEditingController();
  late String _code;
  late bool _returnRequired;
  String? _error;

  @override
  void initState() {
    super.initState();
    _code = _reasons.first['code']! as String;
    _returnRequired = _reasons.first['requiresReturn']! as bool;
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  Map<String, Object> get _reason =>
      _reasons.firstWhere((reason) => reason['code'] == _code);

  void _submit() {
    final notes = _notesController.text.trim();
    if (_reason['requiresNotes'] == true && notes.length < 10) {
      setState(() => _error = 'Describe what happened in at least 10 characters.');
      return;
    }
    Navigator.of(context).pop(<String, Object?>{
      'failureReason': _code,
      'notes': notes,
      'returnRequired': _returnRequired,
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 18, 20, 18 + bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Report a delivery problem',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'This closes the delivery and alerts the customer and operations.',
              style: TextStyle(color: Color(0xFF6B7468), fontSize: 13),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              key: ValueKey(_code),
              initialValue: _code,
              decoration: const InputDecoration(labelText: 'Reason'),
              items: [
                for (final reason in _reasons)
                  DropdownMenuItem(
                    value: reason['code']! as String,
                    child: Text(reason['label']! as String),
                  ),
              ],
              onChanged: (value) {
                if (value == null) return;
                setState(() {
                  _code = value;
                  _returnRequired =
                      _reasons.firstWhere((reason) => reason['code'] == value)['requiresReturn']!
                          as bool;
                  _error = null;
                });
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _notesController,
              maxLines: 3,
              maxLength: 500,
              decoration: InputDecoration(
                labelText: _reason['requiresNotes'] == true
                    ? 'What happened? (required)'
                    : 'What happened? (optional)',
                counterText: '',
              ),
            ),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              title: const Text('Return goods to merchant'),
              subtitle: const Text(
                'A pending return will appear until you confirm hand-back.',
                style: TextStyle(fontSize: 12),
              ),
              value: _returnRequired,
              onChanged: (value) => setState(() => _returnRequired = value),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              ErrorBanner(message: _error!),
            ],
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _submit,
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFA63A32),
                ),
                icon: const Icon(Icons.report_gmailerrorred_outlined),
                label: const Text('Report failed delivery'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QrScanScreen extends StatefulWidget {
  const _QrScanScreen();

  @override
  State<_QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<_QrScanScreen> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [BarcodeFormat.qrCode],
  );
  bool _handled = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    final barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;
    final value = barcodes.first.rawValue;
    if (value == null || value.isEmpty) return;
    _handled = true;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Scan delivery QR'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Toggle torch',
            onPressed: () => _controller.toggleTorch(),
            icon: const Icon(Icons.flashlight_on_outlined),
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              margin: const EdgeInsets.all(24),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.65),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text(
                'Point the camera at the customer delivery QR code.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Signature capture
// ---------------------------------------------------------------------------

class _SignatureModel {
  final List<List<Offset>> strokes = [];
  List<Offset>? _current;

  bool get isEmpty =>
      strokes.isEmpty || strokes.every((stroke) => stroke.length < 2);

  void clear() {
    strokes.clear();
    _current = null;
  }

  void start(Offset point) {
    _current = [point];
    strokes.add(_current!);
  }

  void extend(Offset point) {
    _current?.add(point);
  }

  void end() {
    _current = null;
  }

  ui.Picture toPicture() {
    const size = Size(640, 240);
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, size.height),
      Paint()..color = Colors.white,
    );
    final paint = Paint()
      ..color = const Color(0xFF20261F)
      ..strokeWidth = 3.2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final stroke in strokes) {
      if (stroke.length < 2) continue;
      final path = Path()
        ..moveTo(stroke.first.dx * size.width, stroke.first.dy * size.height);
      for (final point in stroke.skip(1)) {
        path.lineTo(point.dx * size.width, point.dy * size.height);
      }
      canvas.drawPath(path, paint);
    }
    return recorder.endRecording();
  }
}

class _SignaturePad extends StatefulWidget {
  const _SignaturePad({required this.model});

  final _SignatureModel model;

  @override
  State<_SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<_SignaturePad> {
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        Offset normalize(Offset local) => Offset(
          (local.dx / constraints.maxWidth).clamp(0.0, 1.0),
          (local.dy / constraints.maxHeight).clamp(0.0, 1.0),
        );
        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onPanStart: (details) {
            setState(() => widget.model.start(normalize(details.localPosition)));
          },
          onPanUpdate: (details) {
            setState(() => widget.model.extend(normalize(details.localPosition)));
          },
          onPanEnd: (_) => widget.model.end(),
          child: CustomPaint(
            painter: _SignaturePainter(widget.model),
            size: Size.infinite,
          ),
        );
      },
    );
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter(this.model);

  final _SignatureModel model;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF20261F)
      ..strokeWidth = 2.6
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    for (final stroke in model.strokes) {
      if (stroke.length < 2) continue;
      final path = Path()
        ..moveTo(stroke.first.dx * size.width, stroke.first.dy * size.height);
      for (final point in stroke.skip(1)) {
        path.lineTo(point.dx * size.width, point.dy * size.height);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _SignaturePainter oldDelegate) => true;
}
