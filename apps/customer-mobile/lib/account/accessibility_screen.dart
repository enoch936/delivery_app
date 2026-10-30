import 'dart:async';

import 'package:flutter/material.dart';

import '../app_storage.dart';
import '../main.dart';
import 'accessibility_controller.dart';
import 'account_ui.dart';

class AccessibilityScreen extends StatefulWidget {
  const AccessibilityScreen({
    super.key,
    required this.client,
    required this.storage,
    required this.profile,
    required this.onUpdated,
  });

  final ApiClient client;
  final AppStorage storage;
  final Map<String, dynamic> profile;
  final ValueChanged<Map<String, dynamic>> onUpdated;

  @override
  State<AccessibilityScreen> createState() => _AccessibilityScreenState();
}

class _AccessibilityScreenState extends State<AccessibilityScreen> {
  late AccessibilitySettings settings;
  Timer? _syncTimer;
  bool saving = false;

  @override
  void initState() {
    super.initState();
    settings = widget.profile['accessibility'] == null
        ? accessibilityController.value
        : AccessibilitySettings.fromProfile(widget.profile);
  }

  @override
  void dispose() {
    _syncTimer?.cancel();
    super.dispose();
  }

  void _apply(AccessibilitySettings next) {
    setState(() => settings = next);
    accessibilityController.value = next;
    unawaited(widget.storage.saveAccessibility(
      textScale: next.textScale,
      reduceMotion: next.reduceMotion,
      highContrast: next.highContrast,
      screenReaderHints: next.screenReaderHints,
    ));
    _syncTimer?.cancel();
    _syncTimer = Timer(const Duration(milliseconds: 450), _sync);
  }

  Future<void> _sync() async {
    if (!mounted) return;
    setState(() => saving = true);
    try {
      final updated = asMap(await widget.client.patch('/v1/users/me', settings.toApiJson()));
      widget.onUpdated(updated);
    } catch (cause) {
      if (mounted) showAccountMessage(context, 'Saved on this device. ${cause.toString()}');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _reset() async {
    _apply(const AccessibilitySettings());
    await _sync();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Accessibility'),
        actions: [
          if (saving)
            const Padding(
              padding: EdgeInsets.only(right: 16),
              child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
            ),
          TextButton(onPressed: _reset, child: const Text('Reset')),
        ],
      ),
      body: MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(settings.textScale),
          disableAnimations: settings.reduceMotion,
          highContrast: settings.highContrast,
        ),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [accountInk, accountInk.withValues(alpha: 0.85)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Preview', style: TextStyle(color: Colors.white70, fontSize: 11, letterSpacing: 1.1, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 10),
                  const Text('Your delivery is on the way.', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text(
                    'This is how text and spacing will appear across the app at ${(settings.textScale * 100).round()}%.',
                    style: const TextStyle(color: Colors.white70, height: 1.4),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            AccountSection(
              title: 'Text size',
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Text('A', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                          Expanded(
                            child: Slider(
                              value: settings.textScale,
                              min: 1.0,
                              max: 2.0,
                              divisions: 10,
                              label: '${(settings.textScale * 100).round()}%',
                              activeColor: accountAccent,
                              onChanged: (value) => _apply(settings.copyWith(textScale: value)),
                            ),
                          ),
                          const Text('A', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                        ],
                      ),
                      Text(
                        'Current size: ${(settings.textScale * 100).round()}%',
                        style: const TextStyle(color: accountMuted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            AccountSection(
              title: 'Comfort',
              children: [
                SwitchListTile(
                  value: settings.reduceMotion,
                  onChanged: (value) => _apply(settings.copyWith(reduceMotion: value)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                  title: const Text('Reduce motion'),
                  subtitle: const Text('Minimise animations and transitions.'),
                ),
                SwitchListTile(
                  value: settings.highContrast,
                  onChanged: (value) => _apply(settings.copyWith(highContrast: value)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                  title: const Text('High contrast'),
                  subtitle: const Text('Increase contrast between text and backgrounds.'),
                ),
                SwitchListTile(
                  value: settings.screenReaderHints,
                  onChanged: (value) => _apply(settings.copyWith(screenReaderHints: value)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
                  title: const Text('Extra screen-reader hints'),
                  subtitle: const Text('Add descriptive labels to buttons and controls.'),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const Text(
              'Accessibility choices are saved to this device immediately and synced to your account.',
              style: TextStyle(color: accountMuted, fontSize: 12, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}
