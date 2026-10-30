import 'package:flutter/material.dart';

import '../main.dart';
import 'account_ui.dart';

class PrivacyDataScreen extends StatefulWidget {
  const PrivacyDataScreen({
    super.key,
    required this.client,
    required this.profile,
    required this.onUpdated,
    required this.onAccountClosed,
  });

  final ApiClient client;
  final Map<String, dynamic> profile;
  final ValueChanged<Map<String, dynamic>> onUpdated;
  final Future<void> Function() onAccountClosed;

  @override
  State<PrivacyDataScreen> createState() => _PrivacyDataScreenState();
}

class _PrivacyDataScreenState extends State<PrivacyDataScreen> {
  late Map<String, dynamic> profile;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    profile = Map<String, dynamic>.from(widget.profile);
  }

  Map<String, dynamic>? get pendingDeletion => profile['deletion'] is Map ? asMap(profile['deletion']) : null;

  Future<void> _saveConsents({bool? marketing, bool? analytics, bool acceptTerms = false, bool acceptPrivacy = false}) async {
    setState(() => busy = true);
    try {
      final updated = asMap(await widget.client.patch('/v1/users/me', {
        'marketingConsent': ?marketing,
        'analyticsConsent': ?analytics,
        if (acceptTerms) 'acceptTerms': true,
        if (acceptPrivacy) 'acceptPrivacy': true,
      }));
      setState(() => profile = updated);
      widget.onUpdated(updated);
      if (acceptTerms || acceptPrivacy) {
        if (mounted) showAccountMessage(context, 'Consent recorded.');
      }
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _export() async {
    setState(() => busy = true);
    try {
      final result = asMap(await widget.client.get('/v1/users/me/export'));
      if (!mounted) return;
      final orders = asList(result['orders']).length;
      final addresses = asList(result['addresses']).length;
      final favorites = asList(result['favorites']).length;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Your data export'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Generated ${shortDate(result['exportedAt']?.toString())}.'),
              const SizedBox(height: 12),
              _line('Orders', orders),
              _line('Saved addresses', addresses),
              _line('Favorites', favorites),
              const SizedBox(height: 12),
              const Text(
                'This export contains the account data currently held for you. Delivery records required for tax and dispute handling are retained under the retention policy.',
                style: TextStyle(color: accountMuted, fontSize: 12, height: 1.4),
              ),
            ],
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Close'))],
        ),
      );
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _requestDeletion() async {
    final confirmed = await confirmAccountAction(
      context,
      title: 'Request account deletion?',
      message: 'Your sessions will be ended immediately and your account will be scheduled for permanent deletion in 30 days. You can cancel during the grace period by signing in again.',
      confirmLabel: 'Request deletion',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    setState(() => busy = true);
    try {
      await widget.client.post('/v1/users/me/deletion-request');
      await widget.onAccountClosed();
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _cancelDeletion() async {
    final confirmed = await confirmAccountAction(
      context,
      title: 'Keep your account?',
      message: 'Your scheduled deletion will be cancelled and your account will stay active.',
      confirmLabel: 'Keep account',
    );
    if (!confirmed || !mounted) return;
    setState(() => busy = true);
    try {
      await widget.client.post('/v1/users/me/deletion-request/cancel');
      final updated = asMap(await widget.client.get('/v1/users/me'));
      if (mounted) {
        setState(() => profile = updated);
        widget.onUpdated(updated);
        showAccountMessage(context, 'Account deletion cancelled.');
      }
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget _line(String label, int value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Expanded(child: Text(label, style: const TextStyle(color: accountMuted))),
          Text('$value', style: const TextStyle(fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pending = pendingDeletion;
    final termsAccepted = profile['termsAcceptedAt'] != null;
    final privacyAccepted = profile['privacyAcceptedAt'] != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy & data')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          if (pending != null)
            Container(
              margin: const EdgeInsets.only(bottom: 18),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFBEAE7),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFEFC7C1)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.warning_amber_rounded, color: accountDanger),
                      SizedBox(width: 8),
                      Text('Deletion scheduled', style: TextStyle(color: accountDanger, fontWeight: FontWeight.w800)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Your account will be permanently deleted on ${shortDate(pending['scheduledFor']?.toString())}. Sign-in is still available so you can cancel.',
                    style: const TextStyle(color: accountDanger, fontSize: 12, height: 1.4),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(onPressed: busy ? null : _cancelDeletion, child: const Text('Cancel deletion')),
                ],
              ),
            ),
          AccountSection(
            title: 'Consent',
            children: [
              SwitchListTile(
                value: profile['marketingConsent'] == true,
                onChanged: busy ? null : (value) => _saveConsents(marketing: value),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                title: const Text('Personalised offers'),
                subtitle: const Text('Use my orders and favorites to personalise promotions.'),
              ),
              SwitchListTile(
                value: profile['analyticsConsent'] == true,
                onChanged: busy ? null : (value) => _saveConsents(analytics: value),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                title: const Text('Product analytics'),
                subtitle: const Text('Share anonymous usage data to improve the app.'),
              ),
            ],
          ),
          const SizedBox(height: 20),
          AccountSection(
            title: 'Agreements',
            children: [
              AccountTile(
                icon: Icons.description_outlined,
                title: 'Terms of service',
                subtitle: termsAccepted ? 'Accepted ${shortDate(profile['termsAcceptedAt']?.toString())}' : 'Not accepted yet',
                trailing: termsAccepted
                    ? const StatusPill(label: 'Accepted', color: accountSuccess)
                    : TextButton(onPressed: busy ? null : () => _saveConsents(acceptTerms: true), child: const Text('Accept')),
              ),
              AccountTile(
                icon: Icons.privacy_tip_outlined,
                title: 'Privacy policy',
                subtitle: privacyAccepted ? 'Accepted ${shortDate(profile['privacyAcceptedAt']?.toString())}' : 'Not accepted yet',
                trailing: privacyAccepted
                    ? const StatusPill(label: 'Accepted', color: accountSuccess)
                    : TextButton(onPressed: busy ? null : () => _saveConsents(acceptPrivacy: true), child: const Text('Accept')),
              ),
            ],
          ),
          const SizedBox(height: 20),
          AccountSection(
            title: 'Your data',
            children: [
              AccountTile(
                icon: Icons.download_outlined,
                title: 'Export my data',
                subtitle: 'Download a summary of your profile, orders, addresses and favorites.',
                onTap: busy ? null : _export,
              ),
              AccountTile(
                icon: Icons.delete_outline,
                title: pending == null ? 'Delete my account' : 'Deletion scheduled',
                subtitle: pending == null
                    ? 'Request permanent deletion with a 30-day grace period.'
                    : 'Scheduled for ${shortDate(pending['scheduledFor']?.toString())}.',
                destructive: true,
                onTap: busy ? null : (pending == null ? _requestDeletion : _cancelDeletion),
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Text(
            'Retention: account data is removed 30 days after a verified deletion request. Order, payment and tax records that we are legally required to keep are retained for the period required by Ethiopian financial regulations.',
            style: TextStyle(color: accountMuted, fontSize: 11, height: 1.5),
          ),
        ],
      ),
    );
  }
}
