import 'package:flutter/material.dart';
import '../domain/helpers.dart';

class _LiveTrackingCard extends StatelessWidget {
  const _LiveTrackingCard({required this.tracking, required this.connected});

  final Map<String, dynamic> tracking;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final courier = asMap(tracking['courier']);
    final location = asMap(courier['location']);
    final distance = courier['distanceToDestinationMeters'] as num?;
    final eta = courier['etaMinutes'] as num?;
    final destination = asMap(tracking['destination']);
    final active = tracking['liveTrackingEnabled'] == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.near_me_outlined, size: 20),
                const SizedBox(width: 8),
                Text('Live delivery', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const Spacer(),
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: connected ? const Color(0xFF2F6B4F) : const Color(0xFFA63A32),
                  ),
                ),
                const SizedBox(width: 6),
                Text(connected ? 'Live' : 'Reconnecting', style: theme.textTheme.labelSmall),
              ],
            ),
            const SizedBox(height: 10),
            Text(label(tracking['status']?.toString()), style: const TextStyle(fontWeight: FontWeight.w700)),
            if (courier['displayName'] != null) ...[
              const SizedBox(height: 6),
              Text('Courier: ${courier['displayName']}'),
            ],
            if (courier['vehicleType'] != null)
              Text('Vehicle: ${label(courier['vehicleType']?.toString())}'),
            if (distance != null || eta != null) ...[
              const SizedBox(height: 8),
              Text([
                if (distance != null) '${(distance / 1000).toStringAsFixed(1)} km away',
                if (eta != null) 'about $eta min',
              ].join(' · ')),
            ],
            if (location['lastSeenAt'] != null) ...[
              const SizedBox(height: 4),
              Text('Location updated ${shortDate(location['lastSeenAt']?.toString())}', style: theme.textTheme.labelSmall),
            ],
            if (destination['latitude'] != null && destination['longitude'] != null) ...[
              const SizedBox(height: 4),
              Text(
                'Destination: ${(destination['latitude'] as num).toStringAsFixed(5)}, ${(destination['longitude'] as num).toStringAsFixed(5)}',
                style: theme.textTheme.labelSmall,
              ),
            ],
            if (!active) ...[
              const SizedBox(height: 8),
              Text('Live location is paused for this order.', style: theme.textTheme.labelSmall),
            ],
          ],
        ),
      ),
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({
    super.key,
    required this.user,
    required this.onSignOut,
    required this.onOpenCart,
    required this.client,
    required this.onLocaleChanged,
  });

  final Map<String, dynamic> user;
  final Future<void> Function() onSignOut;
  final Future<void> Function() onOpenCart;
  final ApiClient client;
  final ValueChanged<String> onLocaleChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final localeCode = Localizations.localeOf(context).languageCode == 'am' ? 'am' : 'en';
    final roles = (user['roles'] as List? ?? const []).map((role) => label(role.toString())).join(', ');
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 30),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: const Color(0xFF1E2A24),
                  child: Text(
                    (user['displayName']?.toString() ?? user['phoneE164']?.toString() ?? 'U').characters.first.toUpperCase(),
                    style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user['displayName']?.toString() ?? 'Delivery customer',
                        style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        user['phoneE164']?.toString() ?? user['email']?.toString() ?? '',
                        style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                      ),
                      if (roles.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(roles, style: theme.textTheme.labelSmall?.copyWith(color: const Color(0xFF6B7468))),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.shopping_bag_outlined),
                title: Text(l10n.yourCart),
                trailing: const Icon(Icons.chevron_right),
                onTap: onOpenCart,
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.language),
                title: Text(l10n.language),
                trailing: DropdownButton<String>(
                  value: localeCode,
                  underline: const SizedBox.shrink(),
                  items: [
                    DropdownMenuItem(value: 'en', child: Text(l10n.english)),
                    DropdownMenuItem(value: 'am', child: Text(l10n.amharic)),
                  ],
                  onChanged: (value) {
                    if (value != null) onLocaleChanged(value);
                  },
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.support_agent),
                title: Text(l10n.helpAndSupport),
                subtitle: Text(l10n.helpSubtitle),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.logout),
                title: Text(l10n.signOut),
                onTap: onSignOut,
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Text(
          '${l10n.connectedTo} $apiBaseUrl',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
        ),
      ],
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 70, horizontal: 24),
      child: Column(
        children: [
          Icon(icon, size: 48, color: const Color(0xFFB7B3AB)),
          const SizedBox(height: 14),
          Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
          ),
        ],
      ),
    );
  }
}
