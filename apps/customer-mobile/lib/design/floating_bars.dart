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
  static const Color onDarkMuted = Color(0xFFC3CFC5);
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
                unselectedForeground: Color(0xFF3A453C),
                disabledForeground: FloatingBarTokens.disabled,
                hoverOverlay: Color(0x14000000),
                badgeBackground: Color(0x1AE8613D),
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
        padding: EdgeInsets.fromLTRB(horizontalPadding, 0, horizontalPadding, bottomPadding),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (contextual != null) ...[
              contextual!,
              const SizedBox(height: 8),
            ],
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
  bool _canScrollLeft = false;
  bool _canScrollRight = false;
  double _itemWidth = 0;
  double _viewportWidth = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _updateEdges());
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
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _revealSelected();
        _updateEdges();
      });
    }
  }

  void _updateEdges() {
    if (!mounted || !_controller.hasClients) return;
    final position = _controller.position;
    final left = position.pixels > 1;
    final right = position.pixels < position.maxScrollExtent - 1;
    if (left != _canScrollLeft || right != _canScrollRight) {
      setState(() {
        _canScrollLeft = left;
        _canScrollRight = right;
      });
    }
  }

  void _revealSelected() {
    if (!_controller.hasClients || _itemWidth <= 0) return;
    final max = _controller.position.maxScrollExtent;
    if (max <= 0) return;
    final target = (_itemWidth * widget.selectedIndex - (_viewportWidth - _itemWidth) / 2)
        .clamp(0.0, max);
    _controller.animateTo(
      target,
      duration: FloatingBarTokens.motion,
      curve: FloatingBarTokens.motionCurve,
    );
  }

  void _handlePointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent || !_controller.hasClients) return;
    final delta = event.scrollDelta.dy != 0 ? event.scrollDelta.dy : event.scrollDelta.dx;
    if (delta == 0) return;
    final next = (_controller.offset + delta).clamp(0.0, _controller.position.maxScrollExtent);
    _controller.jumpTo(next);
  }

  @override
  Widget build(BuildContext context) {
    final style = widget.style;
    if (widget.items.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        _viewportWidth = constraints.maxWidth;
        final available = constraints.maxWidth - style.innerPadding * 2;
        _itemWidth = math.max(widget.minItemWidth, available / widget.items.length);
        final contentWidth = _itemWidth * widget.items.length + style.innerPadding * 2;
        final scrollable = contentWidth > constraints.maxWidth + 0.5;
        return Container(
          height: widget.height,
          decoration: BoxDecoration(
            color: style.background,
            borderRadius: BorderRadius.circular(widget.height / 2),
            border: Border.all(color: style.borderColor),
            boxShadow: [
              BoxShadow(
                color: style.shadowColor,
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              Positioned.fill(
                child: Listener(
                  onPointerSignal: _handlePointerSignal,
                  child: NotificationListener<ScrollNotification>(
                    onNotification: (_) {
                      _updateEdges();
                      return false;
                    },
                    child: SingleChildScrollView(
                      controller: _controller,
                      scrollDirection: Axis.horizontal,
                      physics: const BouncingScrollPhysics(
                        parent: AlwaysScrollableScrollPhysics(),
                      ),
                      padding: EdgeInsets.all(style.innerPadding),
                      child: Row(
                        children: [
                          for (var index = 0; index < widget.items.length; index++)
                            SizedBox(
                              width: _itemWidth,
                              height: widget.height - style.innerPadding * 2,
                              child: _buildItem(index),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              if (scrollable && _canScrollLeft)
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 26,
                  child: IgnorePointer(child: _edgeFade(alignLeft: true)),
                ),
              if (scrollable && _canScrollRight)
                Positioned(
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: 26,
                  child: IgnorePointer(child: _edgeFade(alignLeft: false)),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _edgeFade({required bool alignLeft}) {
    final style = widget.style;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: alignLeft ? Alignment.centerLeft : Alignment.centerRight,
          end: alignLeft ? Alignment.centerRight : Alignment.centerLeft,
          colors: [style.background, style.background.withValues(alpha: 0)],
        ),
      ),
      child: Align(
        alignment: alignLeft ? Alignment.centerLeft : Alignment.centerRight,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Icon(
            alignLeft ? Icons.chevron_left_rounded : Icons.chevron_right_rounded,
            size: 16,
            color: style.unselectedForeground.withValues(alpha: 0.8),
          ),
        ),
      ),
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
                color: selected ? style.selectedBackground : Colors.transparent,
                borderRadius: radius,
              ),
              padding: EdgeInsets.symmetric(horizontal: style.dense ? 8 : 6, vertical: 4),
              child: style.dense
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          selected ? (item.selectedIcon ?? item.icon) : item.icon,
                          size: style.iconSize,
                          color: foreground,
                        ),
                        const SizedBox(width: 5),
                        Flexible(
                          child: Text(
                            item.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: style.labelSize,
                              fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                              color: foreground,
                              letterSpacing: -0.1,
                            ),
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
                              selected ? (item.selectedIcon ?? item.icon) : item.icon,
                              size: style.iconSize,
                              color: foreground,
                            ),
                            if (item.badge != null && item.badge!.isNotEmpty) ...[
                              const SizedBox(width: 4),
                              _badge(item.badge!, selected, style),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          item.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: style.labelSize,
                            fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
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
        color: selected ? Colors.white.withValues(alpha: 0.24) : style.badgeBackground,
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
