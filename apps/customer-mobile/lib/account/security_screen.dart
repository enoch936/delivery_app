import 'package:flutter/material.dart';

import '../main.dart';
import 'account_ui.dart';

class SecurityScreen extends StatefulWidget {
  const SecurityScreen({
    super.key,
    required this.client,
    required this.profile,
    required this.onSignedOut,
  });

  final ApiClient client;
  final Map<String, dynamic> profile;
  final Future<void> Function() onSignedOut;

  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  List<Map<String, dynamic>> sessions = [];
  String? currentSessionId;
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.get('/v1/users/me/sessions'));
      if (!mounted) return;
      setState(() {
        sessions = asList(result['items']);
        currentSessionId = result['currentSessionId']?.toString();
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _revoke(Map<String, dynamic> session) async {
    final isCurrent = session['id']?.toString() == currentSessionId;
    final confirmed = await confirmAccountAction(
      context,
      title: isCurrent ? 'Sign out of this device?' : 'Sign out this device?',
      message: isCurrent
          ? 'You will need to verify your phone number again to sign back in.'
          : 'The session on this device will be ended immediately.',
      confirmLabel: isCurrent ? 'Sign out' : 'End session',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    try {
      await widget.client.post('/v1/users/me/sessions/${session['id']}/revoke');
      if (isCurrent) {
        await widget.onSignedOut();
        return;
      }
      await _load();
      if (mounted) showAccountMessage(context, 'Session ended.');
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    }
  }

  Future<void> _revokeOthers() async {
    final confirmed = await confirmAccountAction(
      context,
      title: 'Sign out other devices?',
      message: 'Every active session except this device will be ended.',
      confirmLabel: 'Sign out others',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    try {
      final result = asMap(await widget.client.post('/v1/users/me/sessions/revoke-others'));
      await _load();
      if (mounted) showAccountMessage(context, '${result['revokedCount'] ?? 0} session(s) ended.');
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final emailVerified = widget.profile['emailVerified'] == true;
    final email = widget.profile['email']?.toString();
    final phone = widget.profile['phoneE164']?.toString() ?? '';
    return Scaffold(
      appBar: AppBar(title: const Text('Security & sign-in')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            AccountSection(
              title: 'Sign-in methods',
              children: [
                AccountTile(
                  icon: Icons.phone_iphone,
                  title: 'Phone number',
                  subtitle: phone,
                  trailing: const StatusPill(label: 'Primary', color: accountSuccess),
                ),
                AccountTile(
                  icon: Icons.alternate_email,
                  title: 'Email',
                  subtitle: email == null || email.isEmpty ? 'Not added' : email,
                  trailing: email == null || email.isEmpty
                      ? const StatusPill(label: 'Missing', color: accountMuted)
                      : StatusPill(label: emailVerified ? 'Verified' : 'Unverified', color: emailVerified ? accountSuccess : const Color(0xFF9A6B00)),
                ),
              ],
            ),
            const SizedBox(height: 22),
            Row(
              children: [
                const Expanded(
                  child: Text('ACTIVE SESSIONS', style: TextStyle(color: accountMuted, fontSize: 11, letterSpacing: 1.1, fontWeight: FontWeight.w800)),
                ),
                TextButton(
                  onPressed: sessions.length > 1 ? _revokeOthers : null,
                  child: const Text('Sign out others'),
                ),
              ],
            ),
            const SizedBox(height: 4),
            if (loading) const AccountLoading(),
            if (error != null)
              AccountEmpty(icon: Icons.cloud_off_outlined, title: 'Could not load sessions', message: error!),
            if (!loading && error == null)
              ...sessions.map((session) {
                final isCurrent = session['id']?.toString() == currentSessionId;
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: accountSurface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: isCurrent ? accountAccent.withValues(alpha: 0.45) : accountBorder),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(color: accountCanvas, borderRadius: BorderRadius.circular(12)),
                        child: Icon(_deviceIcon(session['userAgent']?.toString()), color: accountInk),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(_deviceName(session['userAgent']?.toString()),
                                      style: const TextStyle(fontWeight: FontWeight.w700)),
                                ),
                                if (isCurrent) ...[
                                  const SizedBox(width: 8),
                                  const StatusPill(label: 'This device', color: accountAccent),
                                ],
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text('Signed in ${shortDate(session['createdAt']?.toString())}',
                                style: const TextStyle(color: accountMuted, fontSize: 12)),
                            Text('Expires ${shortDate(session['expiresAt']?.toString())}',
                                style: const TextStyle(color: accountMuted, fontSize: 12)),
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: 'End session',
                        onPressed: () => _revoke(session),
                        icon: const Icon(Icons.logout, size: 20),
                      ),
                    ],
                  ),
                );
              }),
            const SizedBox(height: 12),
            AccountSection(
              title: 'Protection',
              children: [
                const AccountTile(
                  icon: Icons.shield_outlined,
                  title: 'One-time codes',
                  subtitle: 'Codes expire after five minutes and can be used once.',
                  trailing: Icon(Icons.verified_user_outlined, color: accountSuccess),
                ),
                const AccountTile(
                  icon: Icons.lock_outline,
                  title: 'Session expiry',
                  subtitle: 'Sessions are revoked automatically after inactivity or sign-out.',
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  IconData _deviceIcon(String? userAgent) {
    final agent = (userAgent ?? '').toLowerCase();
    if (agent.contains('iphone') || agent.contains('ipad') || agent.contains('ios')) return Icons.phone_iphone;
    if (agent.contains('android')) return Icons.phone_android;
    if (agent.contains('mac') || agent.contains('windows') || agent.contains('linux')) return Icons.laptop_mac;
    return Icons.devices_other;
  }

  String _deviceName(String? userAgent) {
    final agent = userAgent?.trim() ?? '';
    if (agent.isEmpty) return 'Unknown device';
    if (agent.contains('Android')) return 'Android device';
    if (agent.contains('iPhone')) return 'iPhone';
    if (agent.contains('iPad')) return 'iPad';
    if (agent.contains('Macintosh')) return 'Mac';
    if (agent.contains('Windows')) return 'Windows device';
    if (agent.contains('Linux')) return 'Linux device';
    return agent.length > 48 ? '${agent.substring(0, 48)}…' : agent;
  }
}
