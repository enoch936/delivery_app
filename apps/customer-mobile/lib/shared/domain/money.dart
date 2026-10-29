import 'dart:math' show Random;

class Money {
  Money._();

  static const defaultCurrency = 'ETB';

  static String format(num? minor, [String? currency]) {
    final value = (minor ?? 0) / 100;
    final parts = value.toStringAsFixed(2).split('.');
    final whole = parts[0].replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (match) => '${match[1]},',
    );
    return '$whole.${parts[1]} ${currency ?? defaultCurrency}';
  }
}

class FormatHelpers {
  FormatHelpers._();

  static Map<String, dynamic> asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  static List<Map<String, dynamic>> asList(dynamic value) {
    if (value is! List) return <Map<String, dynamic>>[];
    return value.map(asMap).toList();
  }

  static String label(String? value) {
    if (value == null || value.isEmpty) return '—';
    return value
        .toLowerCase()
        .split('_')
        .map((word) => word.isEmpty ? word : word[0].toUpperCase() + word.substring(1))
        .join(' ');
  }

  static String shortDate(String? value) {
    if (value == null) return '—';
    final date = DateTime.tryParse(value)?.toLocal();
    if (date == null) return '—';
    return '${date.day}/${date.month}/${date.year} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
}