import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../main.dart';
import 'account_ui.dart';

class ReferralScreen extends StatefulWidget {
  const ReferralScreen({super.key, required this.client});

  final ApiClient client;

  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  Map<String, dynamic>? _referrals;
  bool loading = true;
  String? _code;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      _error = null;
    });
    try {
      final result = asMap(await widget.client.get('/v1/referrals/me'));
      if (mounted) setState(() => _referrals = result);
    } catch (cause) {
      if (mounted) setState(() => _error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _issueCode() async {
    setState(() => _error = null);
    try {
      final result = asMap(await widget.client.post('/v1/referrals'));
      if (!mounted) return;
      final code = result['code']?.toString();
      if (code != null && code.isNotEmpty) setState(() => _code = code);
      await _load();
    } catch (cause) {
      if (mounted) setState(() => _error = cause.toString());
    }
  }

  Future<void> _copyCode(String code) async {
    await Clipboard.setData(ClipboardData(text: code));
    if (mounted) showAccountMessage(context, 'Referral code copied.');
  }

  @override
  Widget build(BuildContext context) {
    final referrals = _referrals;
    final items = referrals == null ? <Map<String, dynamic>>[] : asList(referrals['items']);
    return Scaffold(
      appBar: AppBar(title: const Text('Referrals & rewards')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: loading
            ? const AccountLoading()
            : _error != null
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  AccountEmpty(icon: Icons.celebration, title: 'Could not load referrals', message: _error!),
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
                        Text('Give a friend a reward', style: TextStyle(color: Colors.white, fontSize: 12, letterSpacing: 1.1, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        Text('Share your code and you both earn loyalty points.', style: const TextStyle(color: Colors.white70, fontSize: 13)),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(14)),
                                child: Text(_code ?? '—', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 1.5)),
                              ),
                            ),
                            const SizedBox(width: 10),
                            FilledButton(
                              onPressed: _code == null || _code!.isEmpty ? _issueCode : () => _copyCode(_code!),
                              child: Text(_code == null || _code!.isEmpty ? 'Generate code' : 'Copy code'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text('Your referrals', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 10),
                  if (items.isEmpty)
                    const AccountEmpty(
                      icon: Icons.celebration_outlined,
                      title: 'No referrals yet',
                      message: 'Share your code and rewards are credited when friends join.',
                    )
                  else
                    ...items.map(
                      (referral) => Card(
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                          title: Text('Referral ${referral['code']?.toString() ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                          subtitle: Text(
                            'Friend ${(referral['refereeUserId'] as String?)?.substring(0, 8) ?? ''} · ${referral['status']?.toString() ?? ''}',
                            style: const TextStyle(color: Color(0xFF6B7468), fontSize: 12),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}
