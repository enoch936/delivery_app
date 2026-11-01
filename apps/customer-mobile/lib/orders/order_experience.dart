part of '../main.dart';

const _oxActiveStatuses = {
  'PENDING_CONFIRMATION',
  'AWAITING_PAYMENT',
  'CONFIRMED',
  'ACCEPTED_BY_MERCHANT',
  'PREPARING',
  'READY_FOR_PICKUP',
  'COURIER_ASSIGNED',
  'COURIER_ARRIVING_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
};

const _oxTerminalStatuses = {
  'DELIVERED',
  'CANCELLED',
  'FAILED',
  'REFUND_PENDING',
  'REFUNDED',
};

const _oxIssueCategories = {
  'missing_item': 'Missing item',
  'wrong_item': 'Wrong item',
  'damaged': 'Damaged item',
  'late_delivery': 'Late delivery',
  'never_delivered': 'Never delivered',
  'quality': 'Quality problem',
  'courier_issue': 'Courier issue',
  'merchant_issue': 'Merchant issue',
  'refund_request': 'Refund request',
  'other': 'Something else',
};

String _oxStatusText(String? status) {
  switch (status) {
    case 'PENDING_CONFIRMATION':
      return 'Awaiting confirmation';
    case 'AWAITING_PAYMENT':
      return 'Awaiting payment';
    case 'CONFIRMED':
      return 'Confirmed';
    case 'ACCEPTED_BY_MERCHANT':
      return 'Merchant accepted';
    case 'PREPARING':
      return 'Preparing your order';
    case 'READY_FOR_PICKUP':
      return 'Ready for pickup';
    case 'COURIER_ASSIGNED':
      return 'Courier assigned';
    case 'COURIER_ARRIVING_PICKUP':
      return 'Courier at pickup';
    case 'PICKED_UP':
      return 'Picked up';
    case 'IN_TRANSIT':
      return 'On the way';
    case 'DELIVERED':
      return 'Delivered';
    case 'CANCELLED':
      return 'Cancelled';
    case 'FAILED':
      return 'Delivery failed';
    case 'REFUND_PENDING':
      return 'Refund pending';
    case 'REFUNDED':
      return 'Refunded';
    default:
      return label(status);
  }
}

Color _oxStatusColor(String? status) {
  switch (status) {
    case 'DELIVERED':
    case 'REFUNDED':
      return const Color(0xFF2E7D5B);
    case 'CANCELLED':
    case 'FAILED':
      return const Color(0xFFB3261E);
    case 'REFUND_PENDING':
      return const Color(0xFFB26A00);
    case 'IN_TRANSIT':
    case 'PICKED_UP':
      return const Color(0xFF0B6E99);
    case 'COURIER_ASSIGNED':
    case 'COURIER_ARRIVING_PICKUP':
      return const Color(0xFF5B4BC4);
    case 'PREPARING':
    case 'READY_FOR_PICKUP':
      return const Color(0xFFB26A00);
    default:
      return const Color(0xFF4A5D52);
  }
}

double _oxProgress(String? status) {
  const pipeline = [
    'PENDING_CONFIRMATION',
    'CONFIRMED',
    'ACCEPTED_BY_MERCHANT',
    'PREPARING',
    'READY_FOR_PICKUP',
    'COURIER_ASSIGNED',
    'COURIER_ARRIVING_PICKUP',
    'PICKED_UP',
    'IN_TRANSIT',
    'DELIVERED',
  ];
  if (status == 'DELIVERED') return 1;
  if (status == 'CANCELLED' || status == 'FAILED') return 0;
  final index = pipeline.indexOf(status ?? '');
  if (index < 0) return 0.08;
  return (index + 1) / pipeline.length;
}

DateTime? _oxDate(dynamic value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}

String _oxRelative(DateTime? time) {
  if (time == null) return 'just now';
  final seconds = DateTime.now().difference(time).inSeconds;
  if (seconds < 10) return 'just now';
  if (seconds < 60) return '${seconds}s ago';
  final minutes = seconds ~/ 60;
  if (minutes < 60) return '${minutes}m ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '${hours}h ago';
  return shortDate(time.toIso8601String());
}

String _oxEtaLabel(Map<String, dynamic> eta) {
  final min = eta['minMinutes'];
  final max = eta['maxMinutes'];
  if (min is num && max is num) return '${min.round()}–${max.round()} min';
  final minutes = eta['minutes'];
  if (minutes is num) return '~${minutes.round()} min';
  return 'Calculating';
}

Color _oxEtaColor(String? confidence) {
  switch (confidence) {
    case 'high':
      return const Color(0xFF2E7D5B);
    case 'medium':
      return const Color(0xFFB26A00);
    default:
      return const Color(0xFFB3261E);
  }
}

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, required this.client});

  final ApiClient client;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  static const _buckets = ['active', 'past', 'cancelled', 'failed', 'all'];

  final Map<String, String> _knownStatuses = {};
  List<Map<String, dynamic>> _orders = [];
  Map<String, dynamic> _counts = {};
  String _bucket = 'active';
  String? _error;
  bool _loading = true;
  bool _firstLoad = true;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(
      const Duration(seconds: 20),
      (_) => _load(silent: true),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = _orders.isEmpty;
        _error = null;
      });
    }
    try {
      final result = asMap(
        await widget.client.get('/v1/orders?bucket=$_bucket&limit=50'),
      );
      if (!mounted) return;
      final items = asList(result['items']);
      if (!_firstLoad) {
        for (final order in items) {
          final id = order['id']?.toString();
          final status = order['status']?.toString();
          final previous = id == null ? null : _knownStatuses[id];
          if (id != null &&
              status != null &&
              previous != null &&
              previous != status) {
            _showMessage(
              '${order['orderNumber'] ?? 'Your order'} is now ${_oxStatusText(status).toLowerCase()}.',
            );
          }
        }
      }
      _firstLoad = false;
      setState(() {
        _orders = items;
        _counts = asMap(result['counts']);
        _error = null;
        _loading = false;
        for (final order in items) {
          final id = order['id']?.toString();
          final status = order['status']?.toString();
          if (id != null && status != null) _knownStatuses[id] = status;
        }
      });
    } catch (cause) {
      if (!mounted) return;
      if (!silent) setState(() => _error = cause.toString());
      if (!silent) setState(() => _loading = false);
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  int _count(String bucket) {
    final value = _counts[bucket];
    return value is num ? value.toInt() : 0;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Stack(
      children: [
        Positioned.fill(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Your orders',
                            style: theme.textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Track deliveries, manage refunds and chat with the store.',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Refresh',
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
          if (_error != null && _error!.contains('401')) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Icon(
                      Icons.lock_clock_outlined,
                      size: 48,
                      color: Color(0xFFE8613D),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Session Expired',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 18,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Please sign in again to view your active orders and delivery history.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Color(0xFF6B7468)),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () => widget.client.signOut(),
                      child: const Text('Sign in with Phone'),
                    ),
                  ],
                ),
              ),
            ),
          ] else if (_error != null) ...[
            ErrorBanner(message: _error!),
            const SizedBox(height: 12),
            Center(
              child: OutlinedButton(
                onPressed: _load,
                child: const Text('Try Again'),
              ),
            ),
          ],
          if (_loading && _orders.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 100),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (!_loading && _orders.isEmpty && _error == null)
            EmptyState(
              icon: Icons.receipt_long_outlined,
              title: _bucket == 'active'
                  ? 'No active orders'
                  : 'No ${_bucket == 'all' ? '' : '${label(_bucket).toLowerCase()} '}orders yet',
              message: _bucket == 'active'
                  ? 'Start shopping and your live delivery will appear here.'
                  : 'Your delivery history will appear here.',
            ),
          ..._orders.map(
            (order) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _OxOrderCard(
                order: order,
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
              ],
            ),
          ),
        ),
        Positioned(
          left: 12,
          right: 12,
          bottom: 8,
          child: _ordersBucketBar(),
        ),
      ],
    );
  }

  Widget _ordersBucketBar() {
    const icons = <String, IconData>{
      'active': Icons.local_shipping_outlined,
      'past': Icons.history_rounded,
      'cancelled': Icons.cancel_outlined,
      'failed': Icons.error_outline_rounded,
      'all': Icons.receipt_long_outlined,
    };
    final selected = _buckets.indexOf(_bucket);
    return FloatingCategoryBar(
      semanticsLabel: 'Order status filters',
      selectedIndex: selected < 0 ? 0 : selected,
      minItemWidth: 86,
      onSelected: (index) {
        final bucket = _buckets[index];
        if (_bucket == bucket) return;
        setState(() {
          _bucket = bucket;
          _orders = [];
          _loading = true;
        });
        _load();
      },
      items: [
        for (final bucket in _buckets)
          FloatingBarItem(
            icon: icons[bucket] ?? Icons.receipt_long_outlined,
            label: label(bucket),
            badge: _count(bucket) > 0 ? '${_count(bucket)}' : null,
          ),
      ],
    );
  }
}

class _OxOrderCard extends StatelessWidget {
  const _OxOrderCard({required this.order, required this.onTap});

  final Map<String, dynamic> order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = order['status']?.toString();
    final color = _oxStatusColor(status);
    final active = _oxActiveStatuses.contains(status);
    final currency = order['currency']?.toString();
    final eta = order['deliveryEstimateMinutes'];
    final created = _oxDate(order['createdAt']);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 22,
                    backgroundColor: color.withValues(alpha: 0.12),
                    child: Icon(
                      active
                          ? Icons.delivery_dining_rounded
                          : Icons.storefront_rounded,
                      color: color,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          order['merchantName']?.toString() ?? 'Merchant',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${order['orderNumber']} · ${order['itemCount']} item${(order['itemCount'] as num?) == 1 ? '' : 's'}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right_rounded),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _OxStatusPill(status: status),
                  if (active && eta is num) ...[
                    const SizedBox(width: 8),
                    Icon(
                      Icons.schedule_rounded,
                      size: 15,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 3),
                    Text(
                      '~${eta.round()} min',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                  const Spacer(),
                  Text(
                    money(order['totalMinor'] as num?, currency),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                created == null
                    ? ''
                    : 'Placed ${shortDate(created.toIso8601String())}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OxStatusPill extends StatelessWidget {
  const _OxStatusPill({required this.status, this.compact = false});

  final String? status;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final color = _oxStatusColor(status);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 10,
        vertical: compact ? 3 : 5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Text(
        _oxStatusText(status),
        style: TextStyle(
          color: color,
          fontSize: compact ? 11 : 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({
    super.key,
    required this.client,
    required this.orderId,
  });

  final ApiClient client;
  final String orderId;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen>
    with WidgetsBindingObserver {
  Map<String, dynamic>? _order;
  Map<String, dynamic>? _tracking;
  String? _error;
  bool _loading = true;
  bool _busy = false;
  bool _firstLoad = true;
  String? _lastStatus;
  WebSocket? _socket;
  Timer? _pollTimer;
  Timer? _reconnectTimer;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _pollTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!_disposed) _load(silent: true);
    });
    _connectLiveTracking();
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    _reconnectTimer?.cancel();
    _socket?.close();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _load(silent: true);
      _connectLiveTracking();
    }
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = _order == null;
        _error = null;
      });
    }
    try {
      final detail = asMap(
        await widget.client.get('/v1/orders/${widget.orderId}'),
      );
      Map<String, dynamic>? tracking;
      try {
        tracking = asMap(
          await widget.client.get('/v1/tracking/${widget.orderId}'),
        );
      } catch (_) {
        tracking = null;
      }
      if (!mounted) return;
      _handleStatus(detail['status']?.toString());
      setState(() {
        _order = detail;
        _tracking = tracking;
        _error = null;
        _loading = false;
      });
    } catch (cause) {
      if (!mounted) return;
      if (!silent) {
        setState(() {
          _error = cause.toString();
          _loading = false;
        });
      }
    }
  }

  void _handleStatus(String? status) {
    if (!_firstLoad &&
        status != null &&
        _lastStatus != null &&
        status != _lastStatus) {
      _showMessage('Order update: ${_oxStatusText(status)}');
    }
    if (status != null) _lastStatus = status;
    _firstLoad = false;
  }

  Future<void> _connectLiveTracking() async {
    if (_disposed) return;
    try {
      final socket = await widget.client.openTracking(widget.orderId);
      if (_disposed) {
        await socket.close();
        return;
      }
      _socket?.close();
      _socket = socket;
      socket.listen(
        (raw) {
          if (_disposed) return;
          try {
            final message = asMap(jsonDecode(raw.toString()));
            if (message['type'] != 'tracking') return;
            final data = asMap(message['data']);
            if (!mounted) return;
            _handleStatus(data['status']?.toString());
            setState(() => _tracking = data);
          } catch (_) {
            // Ignore malformed frames and keep the last good snapshot.
          }
        },
        onDone: () {
          if (_disposed) return;
          if (_lastStatus == null ||
              !_oxTerminalStatuses.contains(_lastStatus)) {
            _reconnectTimer?.cancel();
            _reconnectTimer = Timer(
              const Duration(seconds: 8),
              _connectLiveTracking,
            );
          }
        },
        onError: (_) {
          if (_disposed) return;
          _reconnectTimer?.cancel();
          _reconnectTimer = Timer(
            const Duration(seconds: 8),
            _connectLiveTracking,
          );
        },
      );
    } catch (_) {
      // Polling remains the fallback when websocket upgrades are unavailable.
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _refreshOrder() async {
    await _load(silent: true);
  }

  Future<void> _cancel() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _OxCancelDialog(),
    );
    if (reason == null) return;
    setState(() => _busy = true);
    try {
      await widget.client.postQueued('/v1/orders/${widget.orderId}/cancel', {
        'reason': reason,
      });
      _showMessage('Cancellation requested.');
      await _refreshOrder();
    } catch (cause) {
      _showMessage(cause.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _requestRefund() async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _OxRefundDialog(),
    );
    if (reason == null) return;
    setState(() => _busy = true);
    try {
      await widget.client.post('/v1/orders/${widget.orderId}/refunds', {
        'reason': reason,
      });
      _showMessage('Refund request submitted. We will keep you updated.');
      await _refreshOrder();
    } catch (cause) {
      _showMessage(cause.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reportIssue() async {
    final report = await showDialog<Map<String, String>>(
      context: context,
      builder: (_) => const _OxIssueDialog(),
    );
    if (report == null) return;
    setState(() => _busy = true);
    try {
      await widget.client.post('/v1/orders/${widget.orderId}/issues', report);
      _showMessage('Issue reported. Our support team will review it.');
      await _refreshOrder();
    } catch (cause) {
      _showMessage(cause.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rateOrder() async {
    final order = _order;
    if (order == null) return;
    final capabilities = asMap(order['capabilities']);
    final canReview = capabilities['canReview'] == true;
    final canRate = capabilities['canRate'] == true;
    if (!canReview) {
      _showMessage('This order cannot be rated yet.');
      return;
    }
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _OxReviewDialog(canRate: canRate),
    );
    if (result == null) return;
    setState(() => _busy = true);
    try {
      await widget.client.post('/v1/reviews', {
        'orderId': widget.orderId,
        'merchantRating': result['merchantRating'],
        'courierRating': result['courierRating'],
        'comment': result['comment'],
      });
      _showMessage('Thanks! Your review was submitted.');
      await _refreshOrder();
    } catch (cause) {
      _showMessage(cause.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _orderAgain() async {
    final order = _order;
    if (order == null) return;
    final items = asList(order['items']);
    if (items.isEmpty) {
      _showMessage('This order has no items to reorder.');
      return;
    }
    setState(() => _busy = true);
    var added = 0;
    for (final item in items) {
      final productId = item['productId']?.toString();
      final quantity = (item['quantity'] as num?)?.toInt() ?? 1;
      if (productId == null || productId.isEmpty) continue;
      final optionIds = <String>[];
      final options = item['options'];
      if (options is List) {
        for (final option in options) {
          if (option is Map) {
            final optionId = option['optionId']?.toString();
            if (optionId != null && optionId.isNotEmpty) {
              optionIds.add(optionId);
            }
          }
        }
      }
      try {
        await widget.client.post('/v1/cart/items', {
          'productId': productId,
          'quantity': quantity,
          'optionIds': optionIds,
        });
        added++;
      } catch (_) {
        break;
      }
    }
    if (mounted) setState(() => _busy = false);
    if (added > 0) {
      _showMessage(
        'Added $added item${added == 1 ? '' : 's'} to your cart. Review fresh prices and stock before checkout.',
      );
      if (mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => CartScreen(client: widget.client),
          ),
        );
      }
    }
  }

  void _openChat({required String title}) {
    final order = _order;
    if (order == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => OrderChatScreen(
          client: widget.client,
          orderId: widget.orderId,
          title: title,
          subtitle: order['orderNumber']?.toString(),
        ),
      ),
    );
  }

  Future<void> _callCourier(String? phone) async {
    if (phone == null || phone.isEmpty) {
      _showMessage('Courier phone number is not available yet.');
      return;
    }
    final uri = Uri(scheme: 'tel', path: phone);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    } else {
      _showMessage('Calling is not available on this device.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    return Scaffold(
      appBar: AppBar(
        title: Text(order?['orderNumber']?.toString() ?? 'Order details'),
        actions: [
          if (order != null)
            IconButton(
              tooltip: 'Message the store',
              onPressed: () => _openChat(title: 'Order chat'),
              icon: const Icon(Icons.chat_bubble_outline_rounded),
            ),
        ],
      ),
      body: _loading && order == null
          ? const Center(child: CircularProgressIndicator())
          : _error != null && order == null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ErrorBanner(message: _error!),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: _load,
                      child: const Text('Try Again'),
                    ),
                  ],
                ),
              ),
            )
          : order == null
          ? const SizedBox.shrink()
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
                children: [
                  _OxHero(order: order, tracking: _tracking),
                  const SizedBox(height: 12),
                  _OxMapCard(tracking: _tracking, order: order),
                  const SizedBox(height: 12),
                  if (asMap(order['delivery'])['courier'] is Map) ...[
                    _OxCourierCard(
                      delivery: asMap(order['delivery']),
                      tracking: _tracking,
                      onChat: () => _openChat(title: 'Message courier'),
                      onCall: () => _callCourier(
                        asMap(
                          asMap(order['delivery'])['courier'],
                        )['phoneE164']?.toString(),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  _OxTimelineCard(order: order),
                  const SizedBox(height: 12),
                  _OxItemsCard(order: order),
                  const SizedBox(height: 12),
                  _OxDeliveryCard(order: order),
                  if (asList(order['proofOfDelivery']).isNotEmpty) ...[
                    const SizedBox(height: 12),
                    _OxProofCard(proofs: asList(order['proofOfDelivery'])),
                  ],
                  if (asList(order['issues']).isNotEmpty ||
                      asList(order['refunds']).isNotEmpty) ...[
                    const SizedBox(height: 12),
                    _OxResolutionCard(order: order),
                  ],
                ],
              ),
            ),
      bottomNavigationBar: order == null ? null : _floatingActions(order),
    );
  }

  Widget _floatingActions(Map<String, dynamic> order) {
    final capabilities = asMap(order['capabilities']);
    final status = order['status']?.toString();
    final actions = <(FloatingBarItem, Future<void> Function())>[
      (
        const FloatingBarItem(icon: Icons.refresh_rounded, label: 'Refresh'),
        _refreshOrder,
      ),
      (
        const FloatingBarItem(icon: Icons.chat_bubble_outline_rounded, label: 'Message'),
        () async => _openChat(title: 'Order chat'),
      ),
      if (capabilities['canCancel'] == true)
        (
          const FloatingBarItem(icon: Icons.close_rounded, label: 'Cancel'),
          _cancel,
        ),
      if (capabilities['canRequestRefund'] == true)
        (
          const FloatingBarItem(icon: Icons.currency_exchange_rounded, label: 'Refund'),
          _requestRefund,
        ),
      if (capabilities['canReportIssue'] == true)
        (
          const FloatingBarItem(icon: Icons.report_problem_outlined, label: 'Report'),
          _reportIssue,
        ),
      if (capabilities['canReview'] == true)
        (
          const FloatingBarItem(icon: Icons.star_rounded, label: 'Rate'),
          _rateOrder,
        ),
      if (status != 'CANCELLED' && status != 'FAILED')
        (
          const FloatingBarItem(icon: Icons.replay_rounded, label: 'Order again'),
          _orderAgain,
        ),
    ];
    return FloatingBarDock(
      primary: FloatingCategoryBar(
        semanticsLabel: 'Order actions',
        selectedIndex: -1,
        minItemWidth: 88,
        onSelected: (index) {
          if (_busy) return;
          unawaited(actions[index].$2());
        },
        items: actions.map((action) => action.$1).toList(),
      ),
    );
  }
}

class _OxHero extends StatelessWidget {
  const _OxHero({required this.order, required this.tracking});

  final Map<String, dynamic> order;
  final Map<String, dynamic>? tracking;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = order['status']?.toString();
    final color = _oxStatusColor(status);
    final eta = tracking == null ? null : tracking!['eta'];
    final etaMap = eta is Map ? asMap(eta) : null;
    final stale = etaMap?['stale'] == true;
    final merchant = asMap(order['merchant']);
    final created = _oxDate(order['createdAt']);
    return Card(
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          gradient: LinearGradient(
            colors: [color.withValues(alpha: 0.16), theme.colorScheme.surface],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _oxStatusText(status),
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w900,
                          color: color,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        merchant['displayName']?.toString() ?? 'Merchant',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                if (etaMap != null)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: _oxEtaColor(etaMap['confidence']?.toString())
                            .withValues(alpha: 0.35),
                      ),
                    ),
                    child: Column(
                      children: [
                        Text(
                          _oxEtaLabel(etaMap),
                          style: TextStyle(
                            fontWeight: FontWeight.w900,
                            color: _oxEtaColor(
                              etaMap['confidence']?.toString(),
                            ),
                          ),
                        ),
                        Text(
                          stale ? 'Location is stale' : 'Live ETA',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: _oxProgress(status),
                minHeight: 8,
                backgroundColor: color.withValues(alpha: 0.14),
                valueColor: AlwaysStoppedAnimation<Color>(color),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    created == null
                        ? ''
                        : 'Placed ${shortDate(created.toIso8601String())}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                if (etaMap != null && etaMap['distanceMeters'] is num)
                  Text(
                    '${((etaMap['distanceMeters'] as num) / 1000).toStringAsFixed(1)} km remaining',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
            if (stale) ...[
              const SizedBox(height: 8),
              Text(
                'Courier signal was last received ${_oxRelative(_oxDate(etaMap?['lastLocationUpdatedAt']))}. ETA may be wider than usual.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: const Color(0xFFB26A00),
                  height: 1.35,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _OxMapCard extends StatelessWidget {
  const _OxMapCard({required this.tracking, required this.order});

  final Map<String, dynamic>? tracking;
  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final destination = tracking == null ? null : tracking!['destination'];
    final pickup = tracking == null ? null : tracking!['pickup'];
    final courier = tracking == null ? null : asMap(tracking!['courier']);
    final location = courier == null ? null : courier['location'];
    final hasAnyPoint = destination is Map || pickup is Map || location is Map;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Row(
              children: [
                const Icon(Icons.map_outlined, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Live tracking',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                _OxStatusPill(
                  status: order['status']?.toString(),
                  compact: true,
                ),
              ],
            ),
          ),
          SizedBox(
            height: 220,
            child: hasAnyPoint
                ? _OxLiveMap(tracking: tracking!)
                : Container(
                    width: double.infinity,
                    color: theme.colorScheme.surfaceContainerHighest.withValues(
                      alpha: 0.45,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.location_searching_rounded,
                          size: 38,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Waiting for courier location',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'The map will update automatically once the courier starts moving.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
            child: Row(
              children: [
                _OxLegendDot(color: const Color(0xFF0B6E99), text: 'Courier'),
                const SizedBox(width: 14),
                _OxLegendDot(color: const Color(0xFF2E7D5B), text: 'You'),
                if (pickup is Map) ...[
                  const SizedBox(width: 14),
                  _OxLegendDot(color: const Color(0xFFE8613D), text: 'Store'),
                ],
                const Spacer(),
                Text(
                  'OpenStreetMap',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OxLegendDot extends StatelessWidget {
  const _OxLegendDot({required this.color, required this.text});

  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Text(text, style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }
}

class _OxLiveMap extends StatefulWidget {
  const _OxLiveMap({required this.tracking});

  final Map<String, dynamic> tracking;

  @override
  State<_OxLiveMap> createState() => _OxLiveMapState();
}

class _OxLiveMapState extends State<_OxLiveMap> {
  final MapController _controller = MapController();
  bool _fitted = false;
  bool _userMoved = false;
  int _lastSignature = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  LatLng? _point(dynamic value) {
    if (value is! Map) return null;
    final data = asMap(value);
    final latitude = data['latitude'];
    final longitude = data['longitude'];
    if (latitude is num && longitude is num) {
      return LatLng(latitude.toDouble(), longitude.toDouble());
    }
    return null;
  }

  List<LatLng> _allPoints() {
    final points = <LatLng>[];
    final route = widget.tracking['route'];
    if (route is List) {
      for (final item in route) {
        final point = _point(item);
        if (point != null) points.add(point);
      }
    }
    final location = _point(asMap(widget.tracking['courier'])['location']);
    if (location != null) points.add(location);
    final pickup = _point(widget.tracking['pickup']);
    if (pickup != null) points.add(pickup);
    final destination = _point(widget.tracking['destination']);
    if (destination != null) points.add(destination);
    return points;
  }

  @override
  void didUpdateWidget(covariant _OxLiveMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final points = _allPoints();
    if (points.isEmpty) return;
    final signature =
        points.length * 1000 +
        points.last.latitude.round() * 7 +
        points.last.longitude.round();
    if (signature != _lastSignature) {
      _lastSignature = signature;
      if (!_userMoved) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _fit(points);
        });
      }
    }
  }

  void _fit(List<LatLng> points) {
    if (points.isEmpty) return;
    _fitted = true;
    if (points.length == 1) {
      _controller.move(points.first, 15);
      return;
    }
    _controller.fitCamera(
      CameraFit.bounds(
        bounds: LatLngBounds.fromPoints(points),
        padding: const EdgeInsets.all(42),
        maxZoom: 16,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final points = _allPoints();
    final center = points.isEmpty ? const LatLng(0, 0) : points.last;
    final courier = _point(asMap(widget.tracking['courier'])['location']);
    final pickup = _point(widget.tracking['pickup']);
    final destination = _point(widget.tracking['destination']);
    final route = <LatLng>[];
    final rawRoute = widget.tracking['route'];
    if (rawRoute is List) {
      for (final item in rawRoute) {
        final point = _point(item);
        if (point != null) route.add(point);
      }
    }
    if (courier != null && route.isEmpty) route.add(courier);
    if (destination != null && route.isNotEmpty) route.add(destination);
    if (!_fitted) {
      _fitted = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _fit(points);
      });
    }
    return FlutterMap(
      mapController: _controller,
      options: MapOptions(
        initialCenter: center,
        initialZoom: 14,
        minZoom: 3,
        maxZoom: 18,
        onPositionChanged: (camera, hasGesture) {
          if (hasGesture) _userMoved = true;
        },
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.deliveryapp.customer',
          maxNativeZoom: 19,
        ),
        if (route.length > 1)
          PolylineLayer(
            polylines: [
              Polyline(
                points: route,
                strokeWidth: 4,
                color: const Color(0xFF0B6E99).withValues(alpha: 0.55),
              ),
            ],
          ),
        MarkerLayer(
          markers: [
            if (pickup != null)
              Marker(
                point: pickup,
                width: 40,
                height: 40,
                child: _OxMapMarker(
                  icon: Icons.storefront_rounded,
                  color: const Color(0xFFE8613D),
                  tooltip: 'Store',
                ),
              ),
            if (destination != null)
              Marker(
                point: destination,
                width: 40,
                height: 40,
                child: _OxMapMarker(
                  icon: Icons.location_on_rounded,
                  color: const Color(0xFF2E7D5B),
                  tooltip: 'Your address',
                ),
              ),
            if (courier != null)
              Marker(
                point: courier,
                width: 46,
                height: 46,
                child: _OxMapMarker(
                  icon: Icons.delivery_dining_rounded,
                  color: const Color(0xFF0B6E99),
                  tooltip: 'Courier',
                  pulse: true,
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _OxMapMarker extends StatelessWidget {
  const _OxMapMarker({
    required this.icon,
    required this.color,
    required this.tooltip,
    this.pulse = false,
  });

  final IconData icon;
  final Color color;
  final String tooltip;
  final bool pulse;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Container(
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2.5),
          boxShadow: [
            BoxShadow(
              color: color.withValues(alpha: pulse ? 0.45 : 0.25),
              blurRadius: pulse ? 14 : 8,
              spreadRadius: pulse ? 3 : 1,
            ),
          ],
        ),
        child: Icon(icon, color: Colors.white, size: 21),
      ),
    );
  }
}

class _OxCourierCard extends StatelessWidget {
  const _OxCourierCard({
    required this.delivery,
    required this.tracking,
    required this.onChat,
    required this.onCall,
  });

  final Map<String, dynamic> delivery;
  final Map<String, dynamic>? tracking;
  final VoidCallback onChat;
  final VoidCallback onCall;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final courier = asMap(delivery['courier']);
    final live = tracking == null ? null : asMap(tracking!['courier']);
    final eta = live == null ? null : live['etaMinutes'];
    final rating = courier['rating'];
    final stale = tracking == null
        ? false
        : asMap(asMap(tracking!['eta']))['stale'] == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            CircleAvatar(
              radius: 26,
              backgroundColor: theme.colorScheme.primaryContainer,
              child: const Icon(Icons.person_rounded),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    courier['displayName']?.toString() ?? 'Courier assigned',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    [
                      if (courier['vehicleType'] != null)
                        label(courier['vehicleType']?.toString()),
                      if (rating is num) '★ ${rating.toStringAsFixed(1)}',
                      if (eta is num) 'ETA ~${eta.round()} min',
                    ].join(' · '),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (stale)
                    Text(
                      'Last seen ${_oxRelative(_oxDate(live?['location'] is Map ? asMap(live!['location'])['lastSeenAt'] : null))}',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: const Color(0xFFB26A00),
                      ),
                    ),
                ],
              ),
            ),
            IconButton.filledTonal(
              tooltip: 'Chat with courier',
              onPressed: onChat,
              icon: const Icon(Icons.chat_bubble_outline_rounded),
            ),
            const SizedBox(width: 6),
            IconButton(
              tooltip: 'Call courier',
              onPressed: onCall,
              icon: const Icon(Icons.call_outlined),
            ),
          ],
        ),
      ),
    );
  }
}

class _OxTimelineCard extends StatelessWidget {
  const _OxTimelineCard({required this.order});

  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final timeline = asList(order['timeline']).reversed.toList();
    final status = order['status']?.toString();
    if (timeline.isEmpty) {
      return const SizedBox.shrink();
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.route_rounded, size: 20),
                const SizedBox(width: 8),
                Text(
                  'Delivery timeline',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            for (var index = 0; index < timeline.length; index++)
              _OxTimelineRow(
                event: timeline[index],
                first: index == 0,
                last: index == timeline.length - 1,
                color: index == 0
                    ? _oxStatusColor(status)
                    : theme.colorScheme.outlineVariant,
                current: index == 0,
              ),
          ],
        ),
      ),
    );
  }
}

class _OxTimelineRow extends StatelessWidget {
  const _OxTimelineRow({
    required this.event,
    required this.first,
    required this.last,
    required this.color,
    required this.current,
  });

  final Map<String, dynamic> event;
  final bool first;
  final bool last;
  final Color color;
  final bool current;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final time = _oxDate(event['createdAt']);
    final note = asMap(event['metadata'])['note'];
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 24,
            child: Column(
              children: [
                Container(
                  width: current ? 14 : 10,
                  height: current ? 14 : 10,
                  margin: EdgeInsets.only(top: current ? 3 : 5),
                  decoration: BoxDecoration(
                    color: current ? color : theme.colorScheme.surface,
                    shape: BoxShape.circle,
                    border: Border.all(color: color, width: 2),
                  ),
                ),
                if (!last)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 3),
                      color: theme.colorScheme.outlineVariant.withValues(
                        alpha: 0.65,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _oxStatusText(event['toStatus']?.toString()),
                    style: TextStyle(
                      fontWeight: current ? FontWeight.w800 : FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    time == null
                        ? ''
                        : '${formatClockTime(time)} · ${shortDate(time.toIso8601String())}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (note != null && note.toString().trim().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        note.toString(),
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OxItemsCard extends StatelessWidget {
  const _OxItemsCard({required this.order});

  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = asList(order['items']);
    final totals = asMap(order['totals']);
    final currency =
        totals['currency']?.toString() ?? order['currency']?.toString();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.shopping_bag_outlined, size: 20),
                const SizedBox(width: 8),
                Text(
                  'Order summary',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            for (final item in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 26,
                      height: 26,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(7),
                      ),
                      child: Text(
                        '${item['quantity']}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        item['displayName']?.toString() ?? 'Item',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    Text(money(item['lineTotalMinor'] as num?, currency)),
                  ],
                ),
              ),
            const Divider(height: 20),
            _OxMoneyRow(
              label: 'Subtotal',
              value: money(totals['itemsSubtotalMinor'] as num?, currency),
            ),
            if ((totals['discountMinor'] as num?) != null &&
                (totals['discountMinor'] as num) > 0)
              _OxMoneyRow(
                label: 'Discount',
                value: '-${money(totals['discountMinor'] as num?, currency)}',
              ),
            _OxMoneyRow(
              label: 'Delivery',
              value: money(totals['deliveryFeeMinor'] as num?, currency),
            ),
            _OxMoneyRow(
              label: 'Service fee',
              value: money(totals['serviceFeeMinor'] as num?, currency),
            ),
            if ((totals['taxMinor'] as num?) != null &&
                (totals['taxMinor'] as num) > 0)
              _OxMoneyRow(
                label: 'Tax',
                value: money(totals['taxMinor'] as num?, currency),
              ),
            if ((totals['tipMinor'] as num?) != null &&
                (totals['tipMinor'] as num) > 0)
              _OxMoneyRow(
                label: 'Tip',
                value: money(totals['tipMinor'] as num?, currency),
              ),
            const Divider(height: 20),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Total',
                    style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
                  ),
                ),
                Text(
                  money(totals['totalMinor'] as num?, currency),
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
            if (order['paymentMethod'] != null ||
                order['paymentStatus'] != null) ...[
              const SizedBox(height: 8),
              Text(
                '${label(order['paymentMethod']?.toString())} · ${label(order['paymentStatus']?.toString())}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _OxMoneyRow extends StatelessWidget {
  const _OxMoneyRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          Text(value),
        ],
      ),
    );
  }
}

class _OxDeliveryCard extends StatelessWidget {
  const _OxDeliveryCard({required this.order});

  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final address = asMap(order['deliveryAddress']);
    final lines =
        [
              address['label'],
              address['recipientName'],
              address['addressLine'],
              address['phoneE164'],
            ]
            .where(
              (value) => value != null && value.toString().trim().isNotEmpty,
            )
            .map((value) => value.toString())
            .toList();
    final instructions = order['deliveryInstructions']?.toString();
    final code = order['deliveryCode']?.toString();
    final scheduled = _oxDate(order['scheduledFor']);
    final cancellation = order['cancellationReason']?.toString();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.location_on_outlined, size: 20),
                const SizedBox(width: 8),
                Text(
                  order['fulfillmentType'] == 'pickup'
                      ? 'Pickup details'
                      : 'Delivery details',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (lines.isNotEmpty)
              Text(lines.join('\n'), style: const TextStyle(height: 1.45)),
            if (instructions != null && instructions.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Instructions: $instructions',
                style: theme.textTheme.bodySmall,
              ),
            ],
            if (scheduled != null) ...[
              const SizedBox(height: 8),
              Text(
                'Scheduled for ${formatSchedule(scheduled)}',
                style: theme.textTheme.bodySmall,
              ),
            ],
            if (code != null && code.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer.withValues(
                    alpha: 0.5,
                  ),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.pin_outlined, size: 18),
                    const SizedBox(width: 8),
                    Text('Delivery code: ', style: theme.textTheme.bodySmall),
                    Text(
                      code,
                      style: const TextStyle(
                        fontWeight: FontWeight.w900,
                        letterSpacing: 2,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (cancellation != null && cancellation.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                'Cancellation reason: $cancellation',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _OxProofCard extends StatelessWidget {
  const _OxProofCard({required this.proofs});

  final List<Map<String, dynamic>> proofs;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.verified_outlined, size: 20),
                const SizedBox(width: 8),
                Text(
                  'Proof of delivery',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            for (final proof in proofs)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      proof['type']?.toString().contains('photo') == true
                          ? Icons.photo_camera_outlined
                          : Icons.check_circle_outline,
                      size: 20,
                      color: const Color(0xFF2E7D5B),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            label(proof['type']?.toString()),
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          if (proof['recipientName'] != null)
                            Text(
                              'Received by ${proof['recipientName']}',
                              style: theme.textTheme.bodySmall,
                            ),
                          if (proof['notes'] != null)
                            Text(
                              proof['notes'].toString(),
                              style: theme.textTheme.bodySmall,
                            ),
                          Text(
                            _oxRelative(_oxDate(proof['createdAt'])),
                            style: theme.textTheme.labelSmall,
                          ),
                        ],
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

class _OxResolutionCard extends StatelessWidget {
  const _OxResolutionCard({required this.order});

  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final issues = asList(order['issues']);
    final refunds = asList(order['refunds']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.support_agent_rounded, size: 20),
                const SizedBox(width: 8),
                Text(
                  'Support & refunds',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            if (refunds.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Refund requests', style: theme.textTheme.labelLarge),
              const SizedBox(height: 6),
              for (final refund in refunds)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              money(
                                refund['amountMinor'] as num?,
                                order['currency']?.toString(),
                              ),
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            Text(
                              refund['reason']?.toString() ?? '',
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      _OxStatusPill(
                        status: refund['status']?.toString(),
                        compact: true,
                      ),
                    ],
                  ),
                ),
            ],
            if (issues.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Reported issues', style: theme.textTheme.labelLarge),
              const SizedBox(height: 6),
              for (final issue in issues)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              _oxIssueCategories[issue['category']
                                      ?.toString()] ??
                                  label(issue['category']?.toString()),
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          _OxStatusPill(
                            status: issue['status']?.toString(),
                            compact: true,
                          ),
                        ],
                      ),
                      if (issue['description'] != null)
                        Text(
                          issue['description'].toString(),
                          style: theme.textTheme.bodySmall,
                        ),
                      if (issue['resolution'] != null)
                        Text(
                          'Resolution: ${issue['resolution']}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: const Color(0xFF2E7D5B),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}


class _OxRefundDialog extends StatefulWidget {
  const _OxRefundDialog();

  @override
  State<_OxRefundDialog> createState() => _OxRefundDialogState();
}

class _OxRefundDialogState extends State<_OxRefundDialog> {
  final TextEditingController _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _reason.text.trim();
    if (value.length < 3) {
      setState(() => _error = 'Please tell us why you need a refund.');
      return;
    }
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Request a refund'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Tell us what went wrong. Our team reviews refund requests and keeps you updated in the app.',
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _reason,
            autofocus: true,
            maxLines: 4,
            maxLength: 500,
            decoration: InputDecoration(
              labelText: 'Reason',
              hintText: 'e.g. Items were missing from my delivery',
              errorText: _error,
              border: const OutlineInputBorder(),
            ),
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Submit request')),
      ],
    );
  }
}

class _OxIssueDialog extends StatefulWidget {
  const _OxIssueDialog();

  @override
  State<_OxIssueDialog> createState() => _OxIssueDialogState();
}

class _OxIssueDialogState extends State<_OxIssueDialog> {
  final TextEditingController _description = TextEditingController();
  String _category = 'missing_item';
  String _priority = 'NORMAL';
  String? _error;

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _description.text.trim();
    if (value.length < 3) {
      setState(
        () => _error = 'Please describe the issue (at least 3 characters).',
      );
      return;
    }
    Navigator.of(
      context,
    ).pop({'category': _category, 'description': value, 'priority': _priority});
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Report an issue'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                for (final entry in _oxIssueCategories.entries)
                  ChoiceChip(
                    label: Text(entry.value),
                    selected: _category == entry.key,
                    onSelected: (_) => setState(() => _category = entry.key),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _description,
              maxLines: 4,
              maxLength: 2000,
              decoration: InputDecoration(
                labelText: 'What happened?',
                errorText: _error,
                border: const OutlineInputBorder(),
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              initialValue: _priority,
              decoration: const InputDecoration(
                labelText: 'Priority',
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(value: 'LOW', child: Text('Low')),
                DropdownMenuItem(value: 'NORMAL', child: Text('Normal')),
                DropdownMenuItem(value: 'HIGH', child: Text('High')),
                DropdownMenuItem(value: 'URGENT', child: Text('Urgent')),
              ],
              onChanged: (value) =>
                  setState(() => _priority = value ?? 'NORMAL'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Submit report')),
      ],
    );
  }
}

class _OxReviewDialog extends StatefulWidget {
  const _OxReviewDialog({required this.canRate});

  final bool canRate;

  @override
  State<_OxReviewDialog> createState() => _OxReviewDialogState();
}

class _OxReviewDialogState extends State<_OxReviewDialog> {
  int _merchantRating = 0;
  int? _courierRating;
  final TextEditingController _comment = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Widget _stars(int value, ValueChanged<int> onChanged) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var index = 1; index <= 5; index++) ...[
          if (index > 1) const SizedBox(width: 8),
          IconButton(
            icon: Icon(
              value >= index ? Icons.star_rounded : Icons.star_border_rounded,
              size: 40,
              color: const Color(0xFFE8613D),
            ),
            onPressed: () => onChanged(index),
          ),
        ],
      ],
    );
  }

  void _submit() {
    if (_merchantRating < 1) {
      setState(() => _error = 'Please select a star rating for the merchant.');
      return;
    }
    Navigator.of(context).pop({
      'merchantRating': _merchantRating,
      'courierRating': _courierRating,
      'comment': _comment.text.trim().isEmpty ? null : _comment.text.trim(),
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Rate this order'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'How was the merchant and the delivery?',
              style: TextStyle(color: Color(0xFF6B7468), fontSize: 13),
            ),
            const SizedBox(height: 12),
            _stars(
              _merchantRating,
              (value) => setState(() => _merchantRating = value),
            ),
            const SizedBox(height: 12),
            if (widget.canRate)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Courier rating (optional)',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                  const SizedBox(height: 8),
                  _stars(
                    (_courierRating ?? 0),
                    (value) => setState(() => _courierRating = value),
                  ),
                ],
              ),
            const SizedBox(height: 12),
            TextField(
              controller: _comment,
              maxLines: 3,
              maxLength: 1000,
              decoration: InputDecoration(
                labelText: 'Comment (optional)',
                hintText: 'Tell others about your experience',
                border: const OutlineInputBorder(),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(
                _error!,
                style: const TextStyle(color: Color(0xFFA63A32), fontSize: 13),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Submit review')),
      ],
    );
  }
}

class _OxCancelDialog extends StatefulWidget {
  const _OxCancelDialog();

  @override
  State<_OxCancelDialog> createState() => _OxCancelDialogState();
}

class _OxCancelDialogState extends State<_OxCancelDialog> {
  static const _reasons = [
    'I changed my mind',
    'Ordered by mistake',
    'Delivery is taking too long',
    'I need to change the address',
    'Other reason',
  ];
  String _reason = _reasons.first;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Cancel this order?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Cancellation may not be possible once the courier has picked up your order.',
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              for (final reason in _reasons)
                ChoiceChip(
                  label: Text(reason),
                  selected: _reason == reason,
                  onSelected: (_) => setState(() => _reason = reason),
                ),
            ],
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Keep order'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
          onPressed: () => Navigator.of(context).pop(_reason),
          child: const Text('Cancel order'),
        ),
      ],
    );
  }
}

class OrderChatScreen extends StatefulWidget {
  const OrderChatScreen({
    super.key,
    required this.client,
    required this.orderId,
    required this.title,
    this.subtitle,
  });

  final ApiClient client;
  final String orderId;
  final String title;
  final String? subtitle;

  @override
  State<OrderChatScreen> createState() => _OrderChatScreenState();
}

class _OrderChatScreenState extends State<OrderChatScreen> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final List<Map<String, dynamic>> _messages = [];
  final Map<String, Map<String, dynamic>> _members = {};
  String? _conversationId;
  String? _error;
  bool _loading = true;
  bool _sending = false;
  Timer? _poll;

  String? get _currentUserId =>
      asMap(widget.client.session?.user)['id']?.toString();

  @override
  void initState() {
    super.initState();
    _open();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _open() async {
    try {
      final conversation = asMap(
        await widget.client.post('/v1/conversations/orders/${widget.orderId}'),
      );
      final id = conversation['id']?.toString();
      if (id == null) throw ApiException('Conversation is not available yet.');
      for (final member in asList(conversation['members'])) {
        final userId = member['userId']?.toString();
        if (userId != null) _members[userId] = member;
      }
      _conversationId = id;
      await _loadMessages();
      _poll?.cancel();
      _poll = Timer.periodic(
        const Duration(seconds: 5),
        (_) => _loadMessages(silent: true),
      );
    } catch (cause) {
      if (mounted) setState(() => _error = cause.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadMessages({bool silent = false}) async {
    final id = _conversationId;
    if (id == null) return;
    try {
      final result = asMap(
        await widget.client.get('/v1/conversations/$id/messages?limit=100'),
      );
      final items = asList(result['items']);
      if (!mounted) return;
      final changed =
          items.length != _messages.length ||
          (items.isNotEmpty &&
              _messages.isNotEmpty &&
              items.last['id'] != _messages.last['id']);
      setState(() {
        _messages
          ..clear()
          ..addAll(items);
        _error = null;
      });
      if (changed) _scrollToLatest();
      if (!silent) unawaited(widget.client.post('/v1/conversations/$id/read'));
    } catch (cause) {
      if (mounted && !silent) setState(() => _error = cause.toString());
    }
  }

  void _scrollToLatest() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        0,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send() async {
    final id = _conversationId;
    final body = _input.text.trim();
    if (id == null || body.isEmpty || _sending) return;
    setState(() => _sending = true);
    _input.clear();
    try {
      await widget.client.post('/v1/conversations/$id/messages', {
        'body': body,
      });
      await _loadMessages(silent: true);
    } catch (cause) {
      _input.text = body;
      if (mounted) setState(() => _error = cause.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _sendQuick(String message) {
    if (_sending) return;
    _input.text = message;
    _input.selection = TextSelection.collapsed(offset: message.length);
    unawaited(_send());
  }

  String _senderName(Map<String, dynamic> message) {
    final userId = message['senderUserId']?.toString();
    final member = _members[userId];
    final name = member?['displayName']?.toString();
    if (name != null && name.trim().isNotEmpty) return name;
    return userId != null && userId == _currentUserId ? 'You' : 'Participant';
  }

  String? _senderRole(Map<String, dynamic> message) {
    final userId = message['senderUserId']?.toString();
    if (userId == _currentUserId) return null;
    final role = _members[userId]?['role']?.toString();
    return role == null ? null : label(role);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final reversed = _messages.reversed.toList();
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.title,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            if (widget.subtitle != null)
              Text(widget.subtitle!, style: theme.textTheme.labelSmall),
          ],
        ),
      ),
      body: Column(
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: ErrorBanner(message: _error!),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : reversed.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.chat_bubble_outline_rounded,
                            size: 42,
                            color: theme.colorScheme.primary,
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'Start the conversation',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 18,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            'Ask about your order, substitutions or delivery updates.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _scroll,
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
                    itemCount: reversed.length,
                    itemBuilder: (context, index) {
                      final message = reversed[index];
                      final mine =
                          message['senderUserId']?.toString() == _currentUserId;
                      final previous = index + 1 < reversed.length
                          ? reversed[index + 1]
                          : null;
                      final showSender =
                          previous == null ||
                          previous['senderUserId'] != message['senderUserId'];
                      return _OxChatBubble(
                        message: message,
                        mine: mine,
                        sender: showSender ? _senderName(message) : null,
                        role: showSender ? _senderRole(message) : null,
                      );
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 2, 12, 6),
            child: FloatingCategoryBar(
              semanticsLabel: 'Quick replies',
              selectedIndex: -1,
              minItemWidth: 104,
              onSelected: (index) {
                const replies = [
                  'On my way',
                  'Please call me when you arrive',
                  'Thank you!',
                ];
                _sendQuick(replies[index]);
              },
              items: const [
                FloatingBarItem(icon: Icons.directions_bike_rounded, label: 'On my way'),
                FloatingBarItem(icon: Icons.phone_in_talk_outlined, label: 'Call me'),
                FloatingBarItem(icon: Icons.favorite_outline_rounded, label: 'Thank you'),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      textCapitalization: TextCapitalization.sentences,
                      minLines: 1,
                      maxLines: 4,
                      decoration: InputDecoration(
                        hintText: 'Write a message…',
                        filled: true,
                        fillColor: theme.colorScheme.surfaceContainerHighest
                            .withValues(alpha: 0.6),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 10,
                        ),
                      ),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OxChatBubble extends StatelessWidget {
  const _OxChatBubble({
    required this.message,
    required this.mine,
    this.sender,
    this.role,
  });

  final Map<String, dynamic> message;
  final bool mine;
  final String? sender;
  final String? role;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final created = _oxDate(message['createdAt']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: mine
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          if (sender != null)
            Padding(
              padding: const EdgeInsets.only(left: 4, right: 4, bottom: 3),
              child: Text(
                role == null ? sender! : '$sender · $role',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.sizeOf(context).width * 0.78,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: mine
                  ? theme.colorScheme.primary
                  : theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(16),
                topRight: const Radius.circular(16),
                bottomLeft: Radius.circular(mine ? 16 : 4),
                bottomRight: Radius.circular(mine ? 4 : 16),
              ),
            ),
            child: Text(
              message['body']?.toString() ?? '',
              style: TextStyle(
                color: mine
                    ? theme.colorScheme.onPrimary
                    : theme.colorScheme.onSurface,
              ),
            ),
          ),
          if (created != null)
            Padding(
              padding: const EdgeInsets.only(top: 3, left: 4, right: 4),
              child: Text(
                formatClockTime(created),
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
