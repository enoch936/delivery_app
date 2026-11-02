import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

/// Shared visual tokens for the delivery platform's floating navigation system.
class FloatingBarTokens {
  const FloatingBarTokens._();

  static const Color ink = Color(0xFF20261F);
  static const Color inkElevated = Color(0xFF1E2A24);
  static const Color inkBorder = Color(0xFF35463C);
  static const Color accent = Color(0xFFE8613D);
  static const Color paper = Color(0xFFF5F2E8);
  static const Color panel = Color(0xFFFFFDF7);
  static const Color line = Color(0xFFD9D5C7);
  static const Color muted = Color(0xFF6B7468);
  static const Color onDark = Color(0xFFEEF0E6);
  static const Color onDarkMuted = Color(0xFFE6EDE7);
  static const Color onLightMuted = Color(0xFF2F3A32);
  static const Color disabled = Color(0xFF8C948D);

  static const Duration motion = Duration(milliseconds: 220);
  static const Curve motionCurve = Curves.easeOutCubic;
}

/// One button rendered inside a floating navigation, category, or action bar.
class FloatingBarItem {
  const FloatingBarItem({
    required this.icon,
    required this.label,
    this.selectedIcon,
    this.badge,
    this.enabled = true,
  });

  final IconData icon;
  final IconData? selectedIcon;
  final String label;
  final String? badge;
  final bool enabled;
}

/// Primary role navigation. Dark, elevated pill that never hides unselected items.
class FloatingNavigationBar extends StatelessWidget {
  const FloatingNavigationBar({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
    this.semanticsLabel = 'Primary navigation',
    this.minItemWidth = 84,
  });

  final List<FloatingBarItem> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final String semanticsLabel;
  final double minItemWidth;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: semanticsLabel,
      child: _ScrollablePillBar(
        items: items,
        selectedIndex: selectedIndex,
        onSelected: onSelected,
        height: 64,
        minItemWidth: minItemWidth,
        style: const _PillBarStyle(
          background: FloatingBarTokens.ink,
          borderColor: FloatingBarTokens.inkBorder,
          shadowColor: Color(0x40000000),
          selectedBackground: FloatingBarTokens.accent,
          selectedForeground: Colors.white,
          unselectedForeground: FloatingBarTokens.onDarkMuted,
          disabledForeground: FloatingBarTokens.disabled,
          hoverOverlay: Color(0x1FFFFFFF),
          badgeBackground: Color(0x33FFFFFF),
          accent: FloatingBarTokens.accent,
          iconSize: 21,
          labelSize: 10.5,
          dense: false,
          innerPadding: 5,
        ),
      ),
    );
  }
}

/// Contextual category, filter, or quick-action bar. Light pill that sits above
/// the primary navigation without covering page content.
class FloatingCategoryBar extends StatelessWidget {
  const FloatingCategoryBar({
    super.key,
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
    this.dark = false,
    this.semanticsLabel = 'Categories and filters',
    this.minItemWidth = 74,
  });

  final List<FloatingBarItem> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final bool dark;
  final String semanticsLabel;
  final double minItemWidth;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: semanticsLabel,
      child: _ScrollablePillBar(
        items: items,
        selectedIndex: selectedIndex,
        onSelected: onSelected,
        height: 54,
        minItemWidth: minItemWidth,
        style: dark
            ? const _PillBarStyle(
                background: FloatingBarTokens.inkElevated,
                borderColor: FloatingBarTokens.inkBorder,
                shadowColor: Color(0x33000000),
                selectedBackground: FloatingBarTokens.accent,
                selectedForeground: Colors.white,
                unselectedForeground: FloatingBarTokens.onDarkMuted,
                disabledForeground: FloatingBarTokens.disabled,
                hoverOverlay: Color(0x1FFFFFFF),
                badgeBackground: Color(0x33FFFFFF),
                accent: FloatingBarTokens.accent,
                iconSize: 17,
                labelSize: 11.5,
                dense: true,
                innerPadding: 5,
              )
            : const _PillBarStyle(
                background: FloatingBarTokens.panel,
                borderColor: FloatingBarTokens.line,
                shadowColor: Color(0x26000000),
                selectedBackground: FloatingBarTokens.accent,
                selectedForeground: Colors.white,
                unselectedForeground: FloatingBarTokens.onLightMuted,
                disabledForeground: FloatingBarTokens.disabled,
                hoverOverlay: Color(0x14000000),
                badgeBackground: Color(0xFFFBE4DC),
                accent: FloatingBarTokens.accent,
                iconSize: 17,
                labelSize: 11.5,
                dense: true,
                innerPadding: 5,
              ),
      ),
    );
  }
}

/// Stacks a contextual bar above the primary bar, keeping both safely inset.
class FloatingBarDock extends StatelessWidget {
  const FloatingBarDock({
    super.key,
    required this.primary,
    this.contextual,
    this.horizontalPadding = 12,
    this.bottomPadding = 10,
  });

  final Widget primary;
  final Widget? contextual;
  final double horizontalPadding;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          horizontalPadding,
          0,
          horizontalPadding,
          bottomPadding,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (contextual != null) ...[contextual!, const SizedBox(height: 8)],
            primary,
          ],
        ),
      ),
    );
  }
}

class _PillBarStyle {
  const _PillBarStyle({
    required this.background,
    required this.borderColor,
    required this.shadowColor,
    required this.selectedBackground,
    required this.selectedForeground,
    required this.unselectedForeground,
    required this.disabledForeground,
    required this.hoverOverlay,
    required this.badgeBackground,
    required this.accent,
    required this.iconSize,
    required this.labelSize,
    required this.dense,
    required this.innerPadding,
  });

  final Color background;
  final Color borderColor;
  final Color shadowColor;
  final Color selectedBackground;
  final Color selectedForeground;
  final Color unselectedForeground;
  final Color disabledForeground;
  final Color hoverOverlay;
  final Color badgeBackground;
  final Color accent;
  final double iconSize;
  final double labelSize;
  final bool dense;
  final double innerPadding;
}

class _ScrollablePillBar extends StatefulWidget {
  const _ScrollablePillBar({
    required this.items,
    required this.selectedIndex,
    required this.onSelected,
    required this.height,
    required this.minItemWidth,
    required this.style,
  });

  final List<FloatingBarItem> items;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final double height;
  final double minItemWidth;
  final _PillBarStyle style;

  @override
  State<_ScrollablePillBar> createState() => _ScrollablePillBarState();
}

class _ScrollablePillBarState extends State<_ScrollablePillBar> {
  final ScrollController _controller = ScrollController();
  List<double> _widths = const [];
  double _viewportWidth = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _revealSelected());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _ScrollablePillBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedIndex != widget.selectedIndex ||
        oldWidget.items.length != widget.items.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _revealSelected());
    }
  }

  void _revealSelected() {
    if (!_controller.hasClients || _widths.isEmpty || _viewportWidth <= 0)
      return;
    final index = widget.selectedIndex;
    if (index < 0 || index >= _widths.length) return;
    final max = _controller.position.maxScrollExtent;
    if (max <= 0) return;
    var leading = 0.0;
    for (var i = 0; i < index; i++) {
      leading += _widths[i];
    }
    final target = (leading + _widths[index] / 2 - _viewportWidth / 2).clamp(
      0.0,
      max,
    );
    _controller.animateTo(
      target,
      duration: FloatingBarTokens.motion,
      curve: FloatingBarTokens.motionCurve,
    );
  }

  void _handlePointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent || !_controller.hasClients) return;
    final delta = event.scrollDelta.dy != 0
        ? event.scrollDelta.dy
        : event.scrollDelta.dx;
    if (delta == 0) return;
    final next = (_controller.offset + delta).clamp(
      0.0,
      _controller.position.maxScrollExtent,
    );
    _controller.jumpTo(next);
  }

  double _measureItem(BuildContext context, int index) {
    final item = widget.items[index];
    final style = widget.style;
    final scaler = MediaQuery.textScalerOf(context);
    final label = TextPainter(
      text: TextSpan(
        text: item.label,
        style: TextStyle(
          fontSize: style.labelSize,
          fontWeight: FontWeight.w800,
          letterSpacing: style.dense ? -0.1 : -0.2,
        ),
      ),
      maxLines: 1,
      textDirection: TextDirection.ltr,
      textScaler: scaler,
    )..layout();
    var badgeWidth = 0.0;
    if (item.badge != null && item.badge!.isNotEmpty) {
      final badge = TextPainter(
        text: TextSpan(
          text: item.badge!,
          style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w800),
        ),
        maxLines: 1,
        textDirection: TextDirection.ltr,
        textScaler: scaler,
      )..layout();
      badgeWidth = badge.width + 14;
    }
    final itemPadding = (style.dense ? 8.0 : 6.0) * 2;
    final iconAndBadge = style.iconSize + badgeWidth;
    final contentWidth = style.dense
        ? style.iconSize + 5 + label.width + badgeWidth + itemPadding
        : math.max(iconAndBadge, label.width) + itemPadding;
    return math.max(widget.minItemWidth, contentWidth + 6);
  }

  @override
  Widget build(BuildContext context) {
    final style = widget.style;
    if (widget.items.isEmpty) return const SizedBox.shrink();
    _widths = [
      for (var index = 0; index < widget.items.length; index++)
        _measureItem(context, index),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        _viewportWidth = constraints.maxWidth;
        return Container(
          height: widget.height,
          decoration: BoxDecoration(
            color: style.background,
            borderRadius: BorderRadius.circular(widget.height / 2),
            border: Border.all(color: style.borderColor),
            boxShadow: [
              BoxShadow(
                color: style.shadowColor,
                blurRadius: 24,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Listener(
            onPointerSignal: _handlePointerSignal,
            child: SingleChildScrollView(
              controller: _controller,
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(
                parent: AlwaysScrollableScrollPhysics(),
              ),
              padding: EdgeInsets.all(style.innerPadding),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (var index = 0; index < widget.items.length; index++)
                    SizedBox(
                      width: _widths[index],
                      height: widget.height - style.innerPadding * 2,
                      child: _buildItem(index),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildItem(int index) {
    final item = widget.items[index];
    final style = widget.style;
    final selected = index == widget.selectedIndex;
    final foreground = !item.enabled
        ? style.disabledForeground
        : selected
        ? style.selectedForeground
        : style.unselectedForeground;
    final radius = BorderRadius.circular(widget.height / 2);
    final selectedGradient = LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [
        style.selectedBackground,
        Color.lerp(style.selectedBackground, Colors.black, 0.14)!,
      ],
    );
    return Semantics(
      button: true,
      selected: selected,
      enabled: item.enabled,
      label: item.badge == null ? item.label : '${item.label}, ${item.badge}',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: item.enabled ? () => widget.onSelected(index) : null,
            borderRadius: radius,
            hoverColor: style.hoverOverlay,
            focusColor: style.hoverOverlay,
            splashColor: style.hoverOverlay,
            highlightColor: style.hoverOverlay,
            child: AnimatedContainer(
              duration: FloatingBarTokens.motion,
              curve: FloatingBarTokens.motionCurve,
              decoration: BoxDecoration(
                color: selected ? null : Colors.transparent,
                gradient: selected ? selectedGradient : null,
                borderRadius: radius,
              ),
              padding: EdgeInsets.symmetric(
                horizontal: style.dense ? 8 : 6,
                vertical: 4,
              ),
              child: style.dense
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          selected
                              ? (item.selectedIcon ?? item.icon)
                              : item.icon,
                          size: style.iconSize,
                          color: foreground,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          item.label,
                          maxLines: 1,
                          softWrap: false,
                          style: TextStyle(
                            fontSize: style.labelSize,
                            fontWeight: selected
                                ? FontWeight.w800
                                : FontWeight.w700,
                            color: foreground,
                            letterSpacing: -0.1,
                          ),
                        ),
                        if (item.badge != null && item.badge!.isNotEmpty) ...[
                          const SizedBox(width: 4),
                          _badge(item.badge!, selected, style),
                        ],
                      ],
                    )
                  : Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              selected
                                  ? (item.selectedIcon ?? item.icon)
                                  : item.icon,
                              size: style.iconSize,
                              color: foreground,
                            ),
                            if (item.badge != null &&
                                item.badge!.isNotEmpty) ...[
                              const SizedBox(width: 4),
                              _badge(item.badge!, selected, style),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.label,
                          maxLines: 1,
                          softWrap: false,
                          style: TextStyle(
                            fontSize: style.labelSize,
                            fontWeight: selected
                                ? FontWeight.w800
                                : FontWeight.w700,
                            color: foreground,
                            letterSpacing: -0.2,
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _badge(String value, bool selected, _PillBarStyle style) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: selected
            ? Colors.white.withValues(alpha: 0.24)
            : style.badgeBackground,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        value,
        style: TextStyle(
          fontSize: 9,
          height: 1.2,
          fontWeight: FontWeight.w800,
          color: selected ? style.selectedForeground : style.accent,
        ),
      ),
    );
  }
}
