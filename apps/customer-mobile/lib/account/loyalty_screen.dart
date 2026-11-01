import 'package:flutter/material.dart';

import '../main.dart';
import 'account_ui.dart';

class LoyaltyScreen extends StatefulWidget {
  const LoyaltyScreen({super.key, required this.client});

  final ApiClient client;

  @override
  State<LoyaltyScreen> createState() => _LoyaltyScreenState();
}

class _LoyaltyScreenState extends State<LoyaltyScreen> {
  Map<String, dynamic>? _account;
  List<Map<String, dynamic>> _rewards = [];
  bool loading = true;
  bool redeeming = false;
  String? _error;
  String? _selectedRewardId;

  @override
  void initState() {
    super.initState();
    _load();
    _loadRewards();
  }

  @override
  void dispose() {
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      _error = null;
    });
    try {
      final result = asMap(await widget.client.get('/v1/loyalty/me'));
      if (mounted) setState(() => _account = result);
    } catch (cause) {
      if (mounted) setState(() => _error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _loadRewards() async {
    try {
      final result = asMap(await widget.client.get('/v1/loyalty/rewards'));
      final items = asList(result['items']);
      if (mounted) setState(() => _rewards = items.map((item) => Map<String, dynamic>.from(item)).toList());
    } catch (cause) {
      if (mounted) setState(() => _error = cause.toString());
    }
  }

  Future<void> _redeemReward(Map<String, dynamic> reward) async {
    final rewardId = reward['id']?.toString();
    if (rewardId == null) return;
    setState(() {
      redeeming = true;
      _error = null;
    });
    try {
      final result = asMap(await widget.client.post('/v1/loyalty/rewards/redeem', {'rewardId': rewardId}));
      await _load();
      await _loadRewards();
      if (mounted) showAccountMessage(context, 'Redeemed ${reward['title']}. Remaining balance: ${(result['balance'] as num?)?.toInt() ?? 0}.');
    } catch (cause) {
      if (mounted) setState(() => _error = cause.toString());
    } finally {
      if (mounted) setState(() => redeeming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final account = _account;
    final points = (account?['points'] as num?)?.toInt() ?? 0;
    final tier = account?['tier']?.toString() ?? 'standard';
    return Scaffold(
      appBar: AppBar(title: const Text('Loyalty rewards')),
      body: RefreshIndicator(
        onRefresh: () async {
          await _load();
          await _loadRewards();
        },
        child: loading
            ? const AccountLoading()
            : _error != null
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  AccountEmpty(icon: Icons.star_rounded, title: 'Could not load loyalty', message: _error!),
                  const SizedBox(height: 20),
                ],
              )
            : ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF20261F), Color(0xFF33452F)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('My loyalty balance', style: TextStyle(color: Colors.white, fontSize: 12, letterSpacing: 1.1, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        Text('$points', style: const TextStyle(color: Colors.white, fontSize: 44, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        Text('Tier: ${tier.toUpperCase()}', style: const TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w700)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text('Points activity', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 10),
                  if (account == null || asList(account['transactions']).isEmpty)
                    const AccountEmpty(
                      icon: Icons.star_outline,
                      title: 'No point activity yet',
                      message: 'Points are earned when a delivered order is completed.',
                    )
                  else
                    ...asList(account['transactions']).map(
                      (transaction) => Card(
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                          title: Text(
                            '${(transaction['points'] as num?)?.toInt() ?? 0} pts · ${transaction['type']?.toString() ?? 'earn'}',
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                          ),
                          subtitle: Text(
                            transaction['source']?.toString() ?? '',
                            style: const TextStyle(color: Color(0xFF6B7468), fontSize: 12),
                          ),
                        ),
                      ),
                    ),
                  const SizedBox(height: 20),
                  Text('Redeemable rewards', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 10),
                  if (_rewards.isEmpty)
                    const AccountEmpty(
                      icon: Icons.card_giftcard_outlined,
                      title: 'No rewards available right now',
                      message: 'New rewards appear here once the merchant publishes them.',
                    )
                  else
                    ..._rewards.map((reward) => _buildRewardCard(context, reward, points)),
                ],
              ),
      ),
    );
  }

  Widget _buildRewardCard(BuildContext context, Map<String, dynamic> reward, int points) {
    final rewardId = reward['id']?.toString() ?? '';
    final title = reward['title']?.toString() ?? 'Reward';
    final description = reward['description']?.toString() ?? '';
    final pointsCost = (reward['pointsCost'] as num?)?.toInt() ?? 0;
    final rewardValueMinor = (reward['rewardValueMinor'] as num?)?.toInt() ?? 0;
    final currency = reward['currency']?.toString() ?? 'ETB';
    final stock = (reward['stock'] as num?)?.toInt() ?? 0;
    final affordable = points >= pointsCost;
    final selected = _selectedRewardId == rewardId;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                ),
                if (!affordable)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: const Color(0xFFF7E8E4), borderRadius: BorderRadius.circular(999)),
                    child: Text('${pointsCost - points} more pts', style: const TextStyle(color: Color(0xFFA63A32), fontSize: 11, fontWeight: FontWeight.w800)),
                  ),
              ],
            ),
            if (description.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(description, style: const TextStyle(color: Color(0xFF6B7468), fontSize: 13)),
            ],
            const SizedBox(height: 10),
            Text('$pointsCost pts · value $rewardValueMinor $currency', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
            const SizedBox(height: 4),
            Text('Stock: $stock', style: const TextStyle(color: Color(0xFF6B7468), fontSize: 12)),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: redeeming || selected || stock <= 0 || !affordable ? null : () => _redeemReward(reward),
              child: redeeming && selected
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(stock > 0 && affordable ? 'Redeem reward' : stock > 0 ? 'Not enough points' : 'Out of stock'),
            ),
          ],
        ),
      ),
    );
  }
}
