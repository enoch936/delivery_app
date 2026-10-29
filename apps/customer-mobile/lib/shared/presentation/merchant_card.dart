import 'package:flutter/material.dart';
import '../domain/helpers.dart';

class MerchantCard extends StatelessWidget {
  const MerchantCard({super.key, required this.merchant, required this.onTap});

  final Map<String, dynamic> merchant;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final categories = (merchant['serviceCategorySlugs'] as List? ?? const [])
        .map((value) => FormatHelpers.label(value.toString()))
        .take(2)
        .join(' · ');
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 62,
                height: 62,
                decoration: BoxDecoration(
                  color: const Color(0xFFF0EAD9),
                  borderRadius: BorderRadius.circular(15),
                ),
                clipBehavior: Clip.antiAlias,
                child: merchant['logoUrl'] != null
                    ? Image.network(
                        merchant['logoUrl'] as String,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stack) => const Icon(Icons.storefront),
                      )
                    : Center(
                        child: Text(
                          (merchant['displayName']?.toString() ?? 'S').characters.first,
                          style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            color: Color(0xFFE8613D),
                          ),
                        ),
                      ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      merchant['displayName']?.toString() ?? 'Merchant',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    if (merchant['description'] != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        merchant['description'].toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468)),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      [if (categories.isNotEmpty) categories, if (merchant['primaryLocationName'] != null) merchant['primaryLocationName'].toString()].join(' · '),
                      style: theme.textTheme.labelSmall?.copyWith(color: const Color(0xFF6B7468)),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Color(0xFF6B7468)),
            ],
          ),
        ),
      ),
    );
  }
}
