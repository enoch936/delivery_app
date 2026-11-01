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
  bool loading = true;
  bool redeeming = false;
  String? _error;
  final TextEditingController _pointsController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _pointsController.dispose();
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

  Future<void> _redeem() async {
    final points = int.tryParse(_pointsController.text.trim());
    if (points == null || points < 1) {
      setState(() => _error = 'Enter the number of points you want to redeem.');
      return;
    }
    setState(() {
      redeeming = true;
      _error = null;
    });
    try {
      final result = asMap(await widget.client.post('/v1/loyalty/redeem', {'points': points}));
      _pointsController.clear();
      await _load();
      if (mounted) showAccountMessage(context, 'Redeemed ${(result['redeemed'] as num?)?.toInt() ?? points} points. Remaining balance: ${(result['balance'] as num?)?.toInt() ?? 0}.');
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
        onRefresh: _load,
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
                  Text('Redeem rewards', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _pointsController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Points to redeem', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: redeeming ? null : _redeem,
                    child: redeeming
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Redeem points'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: Color(0xFFA63A32), fontSize: 13)),
                  ],
                ],
              ),
      ),
    );
  }
}
