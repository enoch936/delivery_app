import 'package:flutter/material.dart';

import '../main.dart';
import 'account_ui.dart';

class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key, required this.client});

  final ApiClient client;

  @override
  State<NotificationPreferencesScreen> createState() => _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState extends State<NotificationPreferencesScreen> {
  Map<String, dynamic> preferences = {};
  bool loading = true;
  bool saving = false;
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
      final result = asMap(await widget.client.get('/v1/notifications/preferences'));
      if (mounted) setState(() => preferences = result);
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  bool _value(String key, {bool fallback = false}) => preferences[key] is bool ? preferences[key] as bool : fallback;

  Future<void> _toggle(String key, bool value) async {
    final previous = Map<String, dynamic>.from(preferences);
    setState(() {
      preferences[key] = value;
      saving = true;
    });
    try {
      final updated = asMap(await widget.client.patch('/v1/notifications/preferences', {key: value}));
      if (mounted) setState(() => preferences = updated);
    } catch (cause) {
      if (mounted) {
        setState(() => preferences = previous);
        showAccountMessage(context, cause.toString());
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (saving)
            const Padding(
              padding: EdgeInsets.only(right: 16),
              child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
            ),
        ],
      ),
      body: Builder(
        builder: (context) {
          if (loading) return const AccountLoading();
          if (error != null) {
            return AccountEmpty(icon: Icons.cloud_off_outlined, title: 'Could not load preferences', message: error!);
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            children: [
              const Text(
                'Choose how we reach you about orders, security and offers. Security alerts cannot be fully disabled.',
                style: TextStyle(color: accountMuted, height: 1.45),
              ),
              const SizedBox(height: 20),
              AccountSection(
                title: 'Channels',
                children: [
                  _switch('pushEnabled', 'Push notifications', 'Order updates and alerts on this device'),
                  _switch('smsEnabled', 'SMS', 'Text messages to your phone number'),
                  _switch('emailEnabled', 'Email', 'Receipts and trip summaries by email'),
                ],
              ),
              const SizedBox(height: 20),
              AccountSection(
                title: 'What you receive',
                children: [
                  _switch('orderUpdates', 'Order updates', 'Status changes, courier arrival and delivery'),
                  _switch('promotions', 'Offers and promotions', 'Deals from merchants you follow'),
                  _switch('securityAlerts', 'Security alerts', 'New sign-ins and account changes'),
                ],
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: accountCanvas, borderRadius: BorderRadius.circular(14)),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline, size: 18, color: accountMuted),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Critical account and delivery notices may still be sent even when optional notifications are off.',
                        style: TextStyle(color: accountMuted, fontSize: 12, height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _switch(String key, String title, String subtitle) {
    return SwitchListTile(
      value: _value(key),
      onChanged: saving ? null : (value) => _toggle(key, value),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle, style: const TextStyle(color: accountMuted, fontSize: 12)),
    );
  }
}
