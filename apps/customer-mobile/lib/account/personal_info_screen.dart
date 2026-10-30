import 'dart:async';

import 'package:flutter/material.dart';

import '../main.dart';
import 'account_ui.dart';

class PersonalInfoScreen extends StatefulWidget {
  const PersonalInfoScreen({
    super.key,
    required this.client,
    required this.profile,
    required this.onUpdated,
  });

  final ApiClient client;
  final Map<String, dynamic> profile;
  final ValueChanged<Map<String, dynamic>> onUpdated;

  @override
  State<PersonalInfoScreen> createState() => _PersonalInfoScreenState();
}

class _PersonalInfoScreenState extends State<PersonalInfoScreen> {
  late final TextEditingController nameController;
  late final TextEditingController emailController;
  late Map<String, dynamic> profile;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    profile = Map<String, dynamic>.from(widget.profile);
    nameController = TextEditingController(text: profile['displayName']?.toString() ?? '');
    emailController = TextEditingController(text: profile['email']?.toString() ?? '');
  }

  @override
  void dispose() {
    nameController.dispose();
    emailController.dispose();
    super.dispose();
  }

  bool get emailVerified => profile['emailVerified'] == true;

  Future<void> save() async {
    final name = nameController.text.trim();
    final email = emailController.text.trim();
    if (name.isNotEmpty && name.length < 2) {
      showAccountMessage(context, 'Enter at least two characters for your name.');
      return;
    }
    setState(() => busy = true);
    try {
      final updated = asMap(await widget.client.patch('/v1/users/me', {
        if (name.isNotEmpty) 'displayName': name,
        'email': email,
      }));
      if (!mounted) return;
      setState(() => profile = updated);
      widget.onUpdated(updated);
      showAccountMessage(context, 'Personal information saved.');
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> verifyEmail() async {
    final email = emailController.text.trim();
    if (email.isEmpty) {
      showAccountMessage(context, 'Add an email address first.');
      return;
    }
    final updated = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _EmailVerificationDialog(client: widget.client, email: email),
    );
    if (updated != null && mounted) {
      setState(() => profile = updated);
      widget.onUpdated(updated);
      showAccountMessage(context, 'Email verified.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final phone = profile['phoneE164']?.toString() ?? '';
    return Scaffold(
      appBar: AppBar(title: const Text('Personal information')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: accountSurface,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: accountBorder),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 26,
                  backgroundColor: accountInk,
                  child: Text(
                    _initial(profile['displayName']?.toString() ?? phone),
                    style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(profile['displayName']?.toString().isNotEmpty == true ? profile['displayName'].toString() : 'Delivery customer',
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 2),
                      Text(phone, style: theme.textTheme.bodySmall?.copyWith(color: accountMuted)),
                    ],
                  ),
                ),
                const StatusPill(label: 'Phone verified', color: accountSuccess),
              ],
            ),
          ),
          const SizedBox(height: 22),
          TextField(
            controller: nameController,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(labelText: 'Full name', hintText: 'e.g. Selam Bekele'),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: emailController,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => save(),
            decoration: InputDecoration(
              labelText: 'Email address',
              hintText: 'you@example.com',
              suffixIcon: profile['email']?.toString().isNotEmpty == true
                  ? Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Center(
                        widthFactor: 1,
                        child: StatusPill(
                          label: emailVerified ? 'Verified' : 'Unverified',
                          color: emailVerified ? accountSuccess : const Color(0xFF9A6B00),
                        ),
                      ),
                    )
                  : null,
            ),
          ),
          if (profile['email']?.toString().isNotEmpty == true && !emailVerified) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(Icons.info_outline, size: 16, color: accountMuted),
                const SizedBox(width: 6),
                const Expanded(
                  child: Text(
                    'Verify your email to recover your account and receive receipts.',
                    style: TextStyle(color: accountMuted, fontSize: 12),
                  ),
                ),
                TextButton(onPressed: busy ? null : verifyEmail, child: const Text('Verify')),
              ],
            ),
          ],
          const SizedBox(height: 24),
          FilledButton(onPressed: busy ? null : save, child: Text(busy ? 'Saving…' : 'Save changes')),
          const SizedBox(height: 12),
          const Text(
            'Your phone number is your sign-in identity and cannot be changed here. Contact support if you no longer use this number.',
            textAlign: TextAlign.center,
            style: TextStyle(color: accountMuted, fontSize: 12, height: 1.4),
          ),
        ],
      ),
    );
  }
}

String _initial(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return 'U';
  return trimmed.characters.first.toUpperCase();
}

class _EmailVerificationDialog extends StatefulWidget {
  const _EmailVerificationDialog({required this.client, required this.email});

  final ApiClient client;
  final String email;

  @override
  State<_EmailVerificationDialog> createState() => _EmailVerificationDialogState();
}

class _EmailVerificationDialogState extends State<_EmailVerificationDialog> {
  final codeController = TextEditingController();
  String? challengeId;
  String? developmentCode;
  String? error;
  bool busy = false;
  int seconds = 0;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    unawaited(send());
  }

  @override
  void dispose() {
    timer?.cancel();
    codeController.dispose();
    super.dispose();
  }

  void startCooldown() {
    timer?.cancel();
    setState(() => seconds = 30);
    timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      if (seconds <= 1) {
        t.cancel();
        setState(() => seconds = 0);
      } else {
        setState(() => seconds -= 1);
      }
    });
  }

  Future<void> send() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.post('/v1/users/me/email/verification/request', {'email': widget.email}));
      setState(() {
        challengeId = result['challengeId']?.toString();
        developmentCode = result['developmentCode']?.toString();
      });
      startCooldown();
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> verify() async {
    if (challengeId == null) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final profile = asMap(await widget.client.post('/v1/users/me/email/verification/verify', {
        'email': widget.email,
        'challengeId': challengeId,
        'code': codeController.text.trim(),
      }));
      if (mounted) Navigator.pop(context, profile);
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Verify email'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Enter the six-digit code sent to ${widget.email}.', style: const TextStyle(color: accountMuted, fontSize: 13)),
          if (developmentCode != null) ...[
            const SizedBox(height: 8),
            Text('Development code: $developmentCode', style: const TextStyle(color: accountAccent, fontSize: 12, fontWeight: FontWeight.w700)),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: codeController,
            keyboardType: TextInputType.number,
            maxLength: 6,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Verification code', counterText: ''),
            onSubmitted: (_) => verify(),
          ),
          if (error != null) ...[
            const SizedBox(height: 10),
            Text(error!, style: const TextStyle(color: accountDanger, fontSize: 12)),
          ],
        ],
      ),
      actions: [
        TextButton(onPressed: busy || seconds > 0 ? null : send, child: Text(seconds > 0 ? 'Resend ${seconds}s' : 'Resend')),
        FilledButton(onPressed: busy ? null : verify, child: Text(busy ? 'Working…' : 'Verify')),
      ],
    );
  }
}
