import 'package:flutter/material.dart';

import '../app_localizations.dart';
import '../main.dart';
import 'accessibility_controller.dart';
import 'accessibility_screen.dart';
import 'account_ui.dart';
import 'address_book_screen.dart';
import 'notifications_screen.dart';
import 'personal_info_screen.dart';
import 'privacy_screen.dart';
import 'security_screen.dart';

class AccountScreen extends StatefulWidget {
  const AccountScreen({
    super.key,
    required this.client,
    required this.user,
    required this.onSignOut,
    required this.onLocaleChanged,
    required this.onOpenCart,
  });

  final ApiClient client;
  final Map<String, dynamic> user;
  final Future<void> Function() onSignOut;
  final ValueChanged<String> onLocaleChanged;
  final Future<void> Function() onOpenCart;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  late Map<String, dynamic> profile;
  bool loading = true;
  String? error;
  int addressCount = 0;

  @override
  void initState() {
    super.initState();
    profile = Map<String, dynamic>.from(widget.user);
    _load();
  }

  Future<void> _load() async {
    setState(() => error = null);
    try {
      final results = await Future.wait([
        widget.client.get('/v1/users/me'),
        widget.client.get('/v1/addresses'),
      ]);
      final next = asMap(results[0]);
      final addresses = asList(asMap(results[1])['items']);
      widget.user
        ..['displayName'] = next['displayName']
        ..['email'] = next['email']
        ..['emailVerified'] = next['emailVerified'];
      if (!mounted) return;
      setState(() {
        profile = next;
        addressCount = addresses.length;
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void _updateProfile(Map<String, dynamic> updated) {
    setState(() => profile = updated);
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    if (mounted) await _load();
  }

  Future<void> _changeLanguage() async {
    final current = Localizations.localeOf(context).languageCode == 'am' ? 'am' : 'en';
    final selected = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('App language', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              ),
            ),
            ListTile(
              onTap: () => Navigator.pop(sheetContext, 'en'),
              title: const Text('English'),
              subtitle: const Text('Default'),
              trailing: current == 'en' ? const Icon(Icons.check_circle, color: accountAccent) : const Icon(Icons.circle_outlined),
            ),
            ListTile(
              onTap: () => Navigator.pop(sheetContext, 'am'),
              title: const Text('አማርኛ'),
              subtitle: const Text('Amharic'),
              trailing: current == 'am' ? const Icon(Icons.check_circle, color: accountAccent) : const Icon(Icons.circle_outlined),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (selected == null || selected == current || !mounted) return;
    final previous = profile['preferredLocale']?.toString();
    widget.onLocaleChanged(selected);
    setState(() => profile['preferredLocale'] = selected);
    try {
      final updated = asMap(await widget.client.patch('/v1/users/me', {'preferredLocale': selected}));
      if (mounted) _updateProfile(updated);
    } catch (cause) {
      if (!mounted) return;
      widget.onLocaleChanged(current);
      setState(() => profile['preferredLocale'] = previous);
      showAccountMessage(context, cause.toString());
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
    try {
      await widget.client.post('/v1/users/me/deletion-request/cancel');
      await _load();
      if (mounted) showAccountMessage(context, 'Account deletion cancelled.');
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    }
  }

  Future<void> _signOut() async {
    final confirmed = await confirmAccountAction(
      context,
      title: 'Sign out?',
      message: 'You will need to verify your phone number to sign back in.',
      confirmLabel: 'Sign out',
      destructive: true,
    );
    if (confirmed) await widget.onSignOut();
  }

  Future<void> _help() async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Help & support'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Common topics:', style: TextStyle(fontWeight: FontWeight.w700)),
            SizedBox(height: 8),
            Text('• Missing or late order — open the order and request help.'),
            Text('• Refund status — refunds return to the original payment method.'),
            Text('• Address changes — update the address before the courier is assigned.'),
            SizedBox(height: 12),
            Text(
              'Support hours are 08:00–20:00 (EAT), every day. Order-specific help is fastest from the Orders tab.',
              style: TextStyle(color: accountMuted, fontSize: 12, height: 1.4),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              widget.onOpenCart();
            },
            child: const Text('Open cart'),
          ),
          FilledButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Close')),
        ],
      ),
    );
  }

  int get _completeness {
    var score = 0;
    if ((profile['displayName']?.toString() ?? '').trim().isNotEmpty) score++;
    if (profile['emailVerified'] == true) score++;
    if (profile['phoneVerified'] == true || profile['phoneE164'] != null) score++;
    if (addressCount > 0) score++;
    if (profile['termsAcceptedAt'] != null) score++;
    return score;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final deletion = profile['deletion'];
    final pendingDeletion = deletion is Map ? asMap(deletion) : null;
    final name = profile['displayName']?.toString();
    final displayName = (name == null || name.trim().isEmpty) ? 'Delivery customer' : name;
    final phone = profile['phoneE164']?.toString() ?? '';
    final email = profile['email']?.toString();
    final score = _completeness;
    final localeCode = Localizations.localeOf(context).languageCode == 'am' ? 'am' : 'en';
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
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
                Row(
                  children: [
                    Container(
                      width: 60,
                      height: 60,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        displayName.characters.first.toUpperCase(),
                        style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            displayName,
                            style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4),
                          ),
                          const SizedBox(height: 4),
                          Text(phone, style: const TextStyle(color: Colors.white70, fontSize: 13)),
                          if (email != null && email.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                Flexible(
                                  child: Text(email, style: const TextStyle(color: Colors.white70, fontSize: 12), overflow: TextOverflow.ellipsis),
                                ),
                                const SizedBox(width: 6),
                                Icon(
                                  profile['emailVerified'] == true ? Icons.verified : Icons.error_outline,
                                  size: 13,
                                  color: profile['emailVerified'] == true ? const Color(0xFF9BE2A6) : const Color(0xFFF2C46B),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: score / 5,
                          minHeight: 6,
                          backgroundColor: Colors.white.withValues(alpha: 0.16),
                          valueColor: const AlwaysStoppedAnimation(Color(0xFFE8613D)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text('$score/5 complete', style: const TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w700)),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  score >= 5 ? 'Your account is fully set up.' : 'Finish setting up for smoother checkouts and recovery.',
                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                ),
              ],
            ),
          ),
          if (pendingDeletion != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFBEAE7),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFEFC7C1)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: accountDanger),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Deletion scheduled', style: TextStyle(color: accountDanger, fontWeight: FontWeight.w800)),
                        Text(
                          'Permanent deletion on ${shortDate(pendingDeletion['scheduledFor']?.toString())}.',
                          style: const TextStyle(color: accountDanger, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  TextButton(onPressed: _cancelDeletion, child: const Text('Cancel')),
                ],
              ),
            ),
          ],
          if (error != null) ...[
            const SizedBox(height: 14),
            ErrorBanner(message: error!),
          ],
          if (loading) ...[
            const SizedBox(height: 18),
            const AccountLoading(),
          ],
          const SizedBox(height: 20),
          AccountSection(
            title: 'Account',
            children: [
              AccountTile(
                icon: Icons.badge_outlined,
                title: 'Personal information',
                subtitle: 'Name, phone, email and verification',
                onTap: () => _open(PersonalInfoScreen(client: widget.client, profile: profile, onUpdated: _updateProfile)),
              ),
              AccountTile(
                icon: Icons.location_on_outlined,
                title: 'Saved addresses',
                subtitle: addressCount == 0 ? 'No addresses yet' : '$addressCount saved',
                onTap: () => _open(AddressBookScreen(client: widget.client)),
              ),
              AccountTile(
                icon: Icons.shield_outlined,
                title: 'Security & sign-in',
                subtitle: 'Active sessions and sign-in methods',
                onTap: () => _open(SecurityScreen(client: widget.client, profile: profile, onSignedOut: widget.onSignOut)),
              ),
              AccountTile(
                icon: Icons.notifications_none_outlined,
                title: l10n.notificationPreferences,
                subtitle: 'Push, SMS, email and alerts',
                onTap: () => _open(NotificationPreferencesScreen(client: widget.client)),
              ),
              AccountTile(
                icon: Icons.privacy_tip_outlined,
                title: 'Privacy & data',
                subtitle: 'Consent, export and account deletion',
                onTap: () => _open(PrivacyDataScreen(
                  client: widget.client,
                  profile: profile,
                  onUpdated: _updateProfile,
                  onAccountClosed: widget.onSignOut,
                )),
              ),
            ],
          ),
          const SizedBox(height: 20),
          AccountSection(
            title: 'Preferences',
            children: [
              AccountTile(
                icon: Icons.language,
                title: l10n.language,
                subtitle: localeCode == 'am' ? l10n.amharic : l10n.english,
                onTap: _changeLanguage,
              ),
              AccountTile(
                icon: Icons.accessibility_new,
                title: 'Accessibility',
                subtitle: accessibilityController.value.textScale == 1.0
                    ? 'Text size, motion and contrast'
                    : 'Text size ${(accessibilityController.value.textScale * 100).round()}%',
                onTap: () => _open(AccessibilityScreen(
                  client: widget.client,
                  storage: widget.client.storage,
                  profile: profile,
                  onUpdated: _updateProfile,
                )),
              ),
              AccountTile(
                icon: Icons.shopping_bag_outlined,
                title: l10n.yourCart,
                subtitle: 'Review items before checkout',
                onTap: widget.onOpenCart,
              ),
            ],
          ),
          const SizedBox(height: 20),
          AccountSection(
            title: 'Support',
            children: [
              AccountTile(
                icon: Icons.support_agent,
                title: l10n.helpAndSupport,
                subtitle: l10n.helpSubtitle,
                onTap: _help,
              ),
              AccountTile(
                icon: Icons.logout,
                title: l10n.signOut,
                destructive: true,
                onTap: _signOut,
              ),
            ],
          ),
          const SizedBox(height: 20),
          Text(
            '${l10n.connectedTo} $apiBaseUrl',
            textAlign: TextAlign.center,
            style: const TextStyle(color: accountMuted, fontSize: 11),
          ),
        ],
      ),
    );
  }
}
