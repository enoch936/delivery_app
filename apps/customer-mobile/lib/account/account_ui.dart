import 'package:flutter/material.dart';

const accountInk = Color(0xFF20261F);
const accountMuted = Color(0xFF6B7468);
const accountBorder = Color(0xFFD9D5C7);
const accountSurface = Color(0xFFFFFDF7);
const accountCanvas = Color(0xFFF4F1E7);
const accountAccent = Color(0xFFE8613D);
const accountSuccess = Color(0xFF2F6B4F);
const accountDanger = Color(0xFFA63A32);

class AccountSection extends StatelessWidget {
  const AccountSection({super.key, this.title, required this.children});

  final String? title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rows = <Widget>[];
    for (var index = 0; index < children.length; index++) {
      if (index > 0) rows.add(const Divider(height: 1, indent: 56));
      rows.add(children[index]);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (title != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(6, 0, 6, 8),
            child: Text(
              title!.toUpperCase(),
              style: theme.textTheme.labelSmall?.copyWith(
                color: accountMuted,
                letterSpacing: 1.1,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        Material(
          color: accountSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: accountBorder),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(children: rows),
        ),
      ],
    );
  }
}

class AccountTile extends StatelessWidget {
  const AccountTile({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.destructive = false,
    this.enabled = true,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool destructive;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = destructive ? accountDanger : accountInk;
    return ListTile(
      enabled: enabled,
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: (destructive ? accountDanger : accountAccent).withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(11),
        ),
        child: Icon(icon, size: 19, color: destructive ? accountDanger : accountAccent),
      ),
      title: Text(title, style: theme.textTheme.bodyLarge?.copyWith(color: color, fontWeight: FontWeight.w600)),
      subtitle: subtitle == null
          ? null
          : Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(subtitle!, style: theme.textTheme.bodySmall?.copyWith(color: accountMuted)),
            ),
      trailing: trailing ?? (onTap == null ? null : const Icon(Icons.chevron_right, color: accountMuted)),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800),
      ),
    );
  }
}

class AccountEmpty extends StatelessWidget {
  const AccountEmpty({super.key, required this.icon, required this.title, required this.message});

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      child: Column(
        children: [
          Icon(icon, size: 42, color: const Color(0xFFB7B3AB)),
          const SizedBox(height: 12),
          Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(message, textAlign: TextAlign.center, style: theme.textTheme.bodySmall?.copyWith(color: accountMuted)),
        ],
      ),
    );
  }
}

class AccountLoading extends StatelessWidget {
  const AccountLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 60),
      child: Center(child: CircularProgressIndicator()),
    );
  }
}

void showAccountMessage(BuildContext context, String message) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

Future<bool> confirmAccountAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
        FilledButton(
          style: destructive
              ? FilledButton.styleFrom(backgroundColor: accountDanger, foregroundColor: Colors.white)
              : null,
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result == true;
}
