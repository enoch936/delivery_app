import 'package:flutter/foundation.dart';

import '../app_storage.dart';

@immutable
class AccessibilitySettings {
  const AccessibilitySettings({
    this.textScale = 1.0,
    this.reduceMotion = false,
    this.highContrast = false,
    this.screenReaderHints = true,
  });

  final double textScale;
  final bool reduceMotion;
  final bool highContrast;
  final bool screenReaderHints;

  factory AccessibilitySettings.fromStorage(AppStorage storage) => AccessibilitySettings(
        textScale: storage.textScale,
        reduceMotion: storage.reduceMotion,
        highContrast: storage.highContrast,
        screenReaderHints: storage.screenReaderHints,
      );

  factory AccessibilitySettings.fromProfile(Map<String, dynamic> profile) {
    final accessibility = profile['accessibility'];
    if (accessibility is! Map) return const AccessibilitySettings();
    final map = Map<String, dynamic>.from(accessibility);
    final scale = (map['textScale'] as num?)?.toDouble() ?? 1.0;
    return AccessibilitySettings(
      textScale: scale.clamp(1.0, 2.0),
      reduceMotion: map['reduceMotion'] == true,
      highContrast: map['highContrast'] == true,
      screenReaderHints: map['screenReaderHints'] != false,
    );
  }

  AccessibilitySettings copyWith({
    double? textScale,
    bool? reduceMotion,
    bool? highContrast,
    bool? screenReaderHints,
  }) =>
      AccessibilitySettings(
        textScale: textScale ?? this.textScale,
        reduceMotion: reduceMotion ?? this.reduceMotion,
        highContrast: highContrast ?? this.highContrast,
        screenReaderHints: screenReaderHints ?? this.screenReaderHints,
      );

  Map<String, dynamic> toApiJson() => {
        'textScale': double.parse(textScale.toStringAsFixed(2)),
        'reduceMotion': reduceMotion,
        'highContrast': highContrast,
        'screenReaderHints': screenReaderHints,
      };
}

class AccessibilityController extends ValueNotifier<AccessibilitySettings> {
  AccessibilityController() : super(const AccessibilitySettings());

  Future<void> load(AppStorage storage) async {
    value = AccessibilitySettings.fromStorage(storage);
  }

  Future<void> update(AppStorage storage, AccessibilitySettings next) async {
    value = next;
    await storage.saveAccessibility(
      textScale: next.textScale,
      reduceMotion: next.reduceMotion,
      highContrast: next.highContrast,
      screenReaderHints: next.screenReaderHints,
    );
  }
}

final accessibilityController = AccessibilityController();
