import 'dart:async';

import 'package:flutter/material.dart';

import '../main.dart';

class DiscoveryScreen extends StatefulWidget {
  const DiscoveryScreen({super.key, required this.client});

  final ApiClient client;

  @override
  State<DiscoveryScreen> createState() => _DiscoveryScreenState();
}

class _DiscoveryScreenState extends State<DiscoveryScreen> {
  final searchController = TextEditingController();
  final pageController = PageController(viewportFraction: 0.92);

  Map<String, dynamic> home = <String, dynamic>{};
  List<Map<String, dynamic>> merchants = [];
  List<Map<String, dynamic>> categories = [];
  List<Map<String, dynamic>> banners = [];
  List<Map<String, dynamic>> featured = [];
  List<Map<String, dynamic>> products = [];
  List<Map<String, dynamic>> recentlyOrdered = [];
  Map<String, dynamic> searchResult = <String, dynamic>{};

  Set<String> favorites = {};
  List<String> recentSearches = [];
  String location = 'Bole, Addis Ababa';
  String? selectedCategory;
  String sort = 'recommended';
  bool openNow = false;
  bool favoritesOnly = false;
  bool loading = true;
  bool loadingList = false;
  bool searching = false;
  String? error;
  String? searchError;
  int promoIndex = 0;
  int _searchGeneration = 0;

  Timer? _debounce;
  Timer? _promoTimer;

  static const _locations = <String, List<double>>{
    'Bole, Addis Ababa': [9.0110, 38.7865],
    'Kazanchis, Addis Ababa': [9.0186, 38.7801],
    'CMC, Addis Ababa': [9.0269, 38.7991],
    'Sarbet, Addis Ababa': [9.0083, 38.7712],
    'Old Airport, Addis Ababa': [8.9972, 38.7889],
    'Piassa, Addis Ababa': [9.0340, 38.7590],
    'Megenagna, Addis Ababa': [9.0148, 38.7661],
  };

  static const _categoryIcons = <String, IconData>{
    'restaurant': Icons.restaurant_rounded,
    'grocery': Icons.local_grocery_store_rounded,
    'retail': Icons.shopping_bag_rounded,
    'pharmacy': Icons.local_pharmacy_rounded,
    'parcel': Icons.inventory_2_rounded,
    'courier': Icons.delivery_dining_rounded,
  };

  double get latitude => _locations[location]?.first ?? 9.0110;
  double get longitude => _locations[location]?.last ?? 38.7865;

  @override
  void initState() {
    super.initState();
    favorites = widget.client.storage.favoriteMerchantIds.toSet();
    recentSearches = widget.client.storage.recentSearches;
    location = widget.client.storage.selectedLocation;
    _bootstrap();
    _promoTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || banners.isEmpty) return;
      setState(() => promoIndex = (promoIndex + 1) % banners.length);
      if (pageController.hasClients) {
        pageController.animateToPage(
          promoIndex,
          duration: const Duration(milliseconds: 450),
          curve: Curves.easeOutCubic,
        );
      }
    });
  }

  @override
  void dispose() {
    searchController.dispose();
    pageController.dispose();
    _debounce?.cancel();
    _promoTimer?.cancel();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        widget.client.get('/v1/discovery/home?lat=$latitude&lng=$longitude'),
        widget.client.get('/v1/merchants?${_merchantQuery()}'),
        if (widget.client.session != null) widget.client.get('/v1/favorites?lat=$latitude&lng=$longitude'),
        if (widget.client.session != null) widget.client.get('/v1/search/recent'),
      ]);
      if (!mounted) return;
      final feed = asMap(results[0]);
      final indexOffset = 2;
      setState(() {
        home = feed;
        banners = asList(feed['banners']);
        categories = asList(feed['categories']);
        featured = asList(feed['featured']);
        products = asList(feed['popularProducts']);
        recentlyOrdered = asList(feed['recentlyOrdered']);
        merchants = asList(asMap(results[1])['items']);
        if (results.length > indexOffset) {
          for (final merchant in asList(asMap(results[indexOffset])['items'])) {
            final id = merchant['id']?.toString();
            if (id != null) favorites.add(id);
          }
        }
        if (results.length > indexOffset + 1) {
          final serverTerms = asList(asMap(results[indexOffset + 1])['items'])
              .map((item) => item['term']?.toString())
              .whereType<String>();
          recentSearches = {...serverTerms, ...recentSearches}.take(8).toList();
        }
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _refresh() async {
    if (searchController.text.trim().isNotEmpty) {
      await _runSearch(searchController.text.trim());
      return;
    }
    await _bootstrap();
  }

  String _merchantQuery({bool withSearch = false}) {
    final query = <String>[
      'sort=$sort',
      'lat=$latitude',
      'lng=$longitude',
      if (selectedCategory != null) 'category=$selectedCategory',
      if (openNow) 'openNow=true',
      if (favoritesOnly) 'favorites=true',
      if (withSearch && searchController.text.trim().isNotEmpty) 'q=${Uri.encodeQueryComponent(searchController.text.trim())}',
    ];
    return query.join('&');
  }

  Future<void> _loadMerchants() async {
    setState(() {
      loadingList = true;
      error = null;
    });
    try {
      final result = await widget.client.get('/v1/merchants?${_merchantQuery()}');
      if (!mounted) return;
      setState(() => merchants = asList(asMap(result)['items']));
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loadingList = false);
    }
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    final term = value.trim();
    if (term.isEmpty) {
      setState(() {
        searching = false;
        searchResult = <String, dynamic>{};
        searchError = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () => _runSearch(term));
  }

  Future<void> _runSearch(String term) async {
    final generation = ++_searchGeneration;
    setState(() {
      searching = true;
      searchError = null;
    });
    try {
      final params = <String>[
        'q=${Uri.encodeQueryComponent(term)}',
        'lat=$latitude',
        'lng=$longitude',
        'limit=30',
        if (selectedCategory != null) 'category=$selectedCategory',
        if (openNow) 'openNow=true',
        if (sort != 'recommended') 'sort=$sort',
      ];
      final result = await widget.client.get('/v1/search?${params.join('&')}');
      if (!mounted || generation != _searchGeneration) return;
      setState(() => searchResult = asMap(result));
    } catch (cause) {
      if (mounted && generation == _searchGeneration) {
        setState(() => searchError = cause.toString());
      }
    }
  }

  Future<void> _commitSearch(String raw) async {
    final term = raw.trim();
    if (term.isEmpty) return;
    searchController.text = term;
    await widget.client.storage.addRecentSearch(term);
    recentSearches = widget.client.storage.recentSearches;
    if (widget.client.session != null) {
      unawaited(widget.client.post('/v1/search/recent', {'term': term}).catchError((_) => null));
    }
    await _runSearch(term);
  }

  Future<void> _clearRecent() async {
    await widget.client.storage.clearRecentSearches();
    recentSearches = [];
    if (widget.client.session != null) {
      try {
        await widget.client.delete('/v1/search/recent');
      } catch (_) {
        // Local history is already cleared.
      }
    }
    if (mounted) setState(() {});
  }

  Future<void> _toggleFavorite(String merchantId) async {
    final added = !favorites.contains(merchantId);
    setState(() {
      if (added) {
        favorites.add(merchantId);
      } else {
        favorites.remove(merchantId);
      }
    });
    await widget.client.storage.toggleFavoriteMerchant(merchantId);
    if (widget.client.session == null) return;
    try {
      if (added) {
        await widget.client.post('/v1/favorites/$merchantId');
      } else {
        await widget.client.delete('/v1/favorites/$merchantId');
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        if (added) {
          favorites.remove(merchantId);
        } else {
          favorites.add(merchantId);
        }
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not sync favorites. Try again.')),
      );
    }
  }

  Future<void> _changeLocation() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        children: [
          Text('Delivery location', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('Availability, ETA and fees update for your area.', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 12),
          ..._locations.keys.map(
            (entry) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.location_on_outlined, color: entry == location ? const Color(0xFFE8613D) : null),
              title: Text(entry, style: TextStyle(fontWeight: entry == location ? FontWeight.w800 : FontWeight.w500)),
              trailing: entry == location ? const Icon(Icons.check_circle, color: Color(0xFFE8613D)) : null,
              onTap: () => Navigator.pop(context, entry),
            ),
          ),
        ],
      ),
    );
    if (selected == null || selected == location) return;
    await widget.client.storage.setSelectedLocation(selected);
    if (!mounted) return;
    setState(() => location = selected);
    await _bootstrap();
  }

  Future<void> _openFilters() async {
    var nextSort = sort;
    var nextOpen = openNow;
    var nextFavorites = favoritesOnly;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 24 + MediaQuery.of(context).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Sort & filters', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 16),
              Text('Sort by', style: Theme.of(context).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final option in const {
                    'recommended': 'Recommended',
                    'distance': 'Nearest',
                    'rating': 'Top rated',
                    'eta': 'Fastest',
                    'name': 'A to Z',
                  }.entries)
                    ChoiceChip(
                      label: Text(option.value),
                      selected: nextSort == option.key,
                      onSelected: (_) => setSheetState(() => nextSort = option.key),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Open now'),
                subtitle: const Text('Hide merchants that are currently closed'),
                value: nextOpen,
                onChanged: (value) => setSheetState(() => nextOpen = value),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Favorites only'),
                subtitle: const Text('Show merchants you saved'),
                value: nextFavorites,
                onChanged: (value) => setSheetState(() => nextFavorites = value),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        setSheetState(() {
                          nextSort = 'recommended';
                          nextOpen = false;
                          nextFavorites = false;
                        });
                      },
                      child: const Text('Reset'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Apply filters'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted) return;
    final changed = nextSort != sort || nextOpen != openNow || nextFavorites != favoritesOnly;
    setState(() {
      sort = nextSort;
      openNow = nextOpen;
      favoritesOnly = nextFavorites;
    });
    if (changed) await _loadMerchants();
  }

  void _selectCategory(String? slug) {
    setState(() => selectedCategory = slug);
    _loadMerchants();
  }

  void _openMerchant(String? id) {
    if (id == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => MerchantScreen(client: widget.client, merchantId: id),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 36),
        children: [
          _locationHeader(),
          const SizedBox(height: 14),
          _searchBar(),
          if (searching) ...[
            const SizedBox(height: 16),
            _searchBody(),
          ] else ...[
            if (recentSearches.isNotEmpty) ...[
              const SizedBox(height: 14),
              _recentSearches(),
            ],
            const SizedBox(height: 16),
            _categoryStrip(),
            const SizedBox(height: 18),
            if (loading && banners.isEmpty)
              _homeSkeleton()
            else if (error != null && home.isEmpty)
              _errorState()
            else ...[
              if (banners.isNotEmpty) ...[
                _bannerCarousel(),
                const SizedBox(height: 18),
              ],
              _statsRow(),
              if (featured.isNotEmpty) ...[
                const SizedBox(height: 20),
                _sectionHeader('Featured near you', 'Curated for ${location.split(',').first}'),
                const SizedBox(height: 10),
                _featuredRail(),
              ],
              if (products.isNotEmpty) ...[
                const SizedBox(height: 20),
                _sectionHeader('Popular picks', 'Ready to add to your cart'),
                const SizedBox(height: 10),
                _productRail(products),
              ],
              if (recentlyOrdered.isNotEmpty) ...[
                const SizedBox(height: 20),
                _sectionHeader('Order again', 'Your recent orders'),
                const SizedBox(height: 10),
                _recentOrderRail(),
              ],
              const SizedBox(height: 22),
              _allMerchantsHeader(),
              const SizedBox(height: 10),
              _merchantsSection(),
            ],
          ],
        ],
      ),
    );
  }

  Widget _locationHeader() {
    final theme = Theme.of(context);
    return Row(
      children: [
        Expanded(
          child: InkWell(
            onTap: _changeLocation,
            borderRadius: BorderRadius.circular(14),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: const Color(0xFF20261F),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.near_me_rounded, color: Colors.white, size: 19),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('DELIVERING TO', style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.1, color: const Color(0xFF6B7468), fontWeight: FontWeight.w700)),
                        Text(location, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800)),
                      ],
                    ),
                  ),
                  const Icon(Icons.keyboard_arrow_down_rounded),
                ],
              ),
            ),
          ),
        ),
        if (widget.client.offline)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(color: const Color(0xFFFFF3E0), borderRadius: BorderRadius.circular(10)),
            child: const Row(
              children: [
                Icon(Icons.cloud_off, size: 14, color: Color(0xFFE65100)),
                SizedBox(width: 4),
                Text('Offline', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFFE65100))),
              ],
            ),
          ),
      ],
    );
  }

  Widget _searchBar() {
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: searchController,
            textInputAction: TextInputAction.search,
            onChanged: _onSearchChanged,
            onSubmitted: _commitSearch,
            decoration: InputDecoration(
              hintText: 'Search restaurants, groceries, services...',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: searchController.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () {
                        searchController.clear();
                        _searchGeneration++;
                        setState(() {
                          searching = false;
                          searchResult = <String, dynamic>{};
                        });
                      },
                    ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
              filled: true,
              fillColor: const Color(0xFFFFFDF7),
            ),
          ),
        ),
        const SizedBox(width: 10),
        SizedBox(
          width: 52,
          height: 52,
          child: FilledButton(
            onPressed: _openFilters,
            style: FilledButton.styleFrom(
              padding: EdgeInsets.zero,
              backgroundColor: (openNow || favoritesOnly || sort != 'recommended') ? const Color(0xFFE8613D) : const Color(0xFF20261F),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            ),
            child: const Icon(Icons.tune_rounded),
          ),
        ),
      ],
    );
  }

  Widget _workWithText(String text) {
    return Text(text, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800));
  }

  Widget _sectionHeader(String title, String subtitle) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _workWithText(title),
              const SizedBox(height: 2),
              Text(subtitle, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF6B7468))),
            ],
          ),
        ),
      ],
    );
  }

  Widget _recentSearches() {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Recent searches', style: Theme.of(context).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700)),
              const Spacer(),
              TextButton(onPressed: _clearRecent, child: const Text('Clear')),
            ],
          ),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: recentSearches
                .map(
                  (term) => ActionChip(
                    avatar: const Icon(Icons.history, size: 16),
                    label: Text(term),
                    onPressed: () => _commitSearch(term),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }

  Widget _categoryStrip() {
    return SizedBox(
      height: 84,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          _CategoryTile(
            icon: Icons.apps_rounded,
            label: 'All',
            selected: selectedCategory == null,
            onTap: () => _selectCategory(null),
          ),
          for (final category in categories)
            _CategoryTile(
              icon: _categoryIcons[category['slug']?.toString()] ?? Icons.storefront_rounded,
              label: category['displayName']?.toString() ?? 'Category',
              badge: category['merchantCount']?.toString(),
              selected: selectedCategory == category['slug']?.toString(),
              onTap: () => _selectCategory(category['slug']?.toString()),
            ),
        ],
      ),
    );
  }

  Widget _bannerCarousel() {
    return Column(
      children: [
        SizedBox(
          height: 172,
          child: PageView.builder(
            controller: pageController,
            itemCount: banners.length,
            onPageChanged: (value) => setState(() => promoIndex = value),
            itemBuilder: (context, index) {
              final banner = banners[index];
              final accent = _parseColor(banner['accentColor']?.toString());
              return Padding(
                padding: const EdgeInsets.only(right: 10),
                child: InkWell(
                  borderRadius: BorderRadius.circular(22),
                  onTap: () {
                    final code = banner['code']?.toString();
                    if (code != null) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Use code $code at checkout')),
                      );
                    }
                  },
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(22),
                      color: accent ?? const Color(0xFF20261F),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        if (banner['imageUrl'] != null)
                          Image.network(
                            banner['imageUrl'].toString(),
                            fit: BoxFit.cover,
                            color: Colors.black.withValues(alpha: 0.32),
                            colorBlendMode: BlendMode.darken,
                            errorBuilder: (context, error, stack) => const SizedBox.shrink(),
                          ),
                        Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              if (banner['code'] != null)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withValues(alpha: 0.2),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text('CODE ${banner['code']}', style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
                                ),
                              const SizedBox(height: 8),
                              Text(
                                banner['title']?.toString() ?? 'Offer',
                                style: const TextStyle(color: Colors.white, fontSize: 22, height: 1.05, fontWeight: FontWeight.w800),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                banner['subtitle']?.toString() ?? '',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 12),
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Text(banner['ctaLabel']?.toString() ?? 'Explore', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 12)),
                                  const SizedBox(width: 4),
                                  const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 15),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        if (banners.length > 1) ...[
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(
              banners.length,
              (index) => AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: index == promoIndex ? 18 : 6,
                height: 6,
                decoration: BoxDecoration(
                  color: index == promoIndex ? const Color(0xFFE8613D) : const Color(0xFFD9D5C7),
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _statsRow() {
    final stats = asMap(home['stats']);
    return Row(
      children: [
        Expanded(child: _statTile('Nearby stores', stats['merchantCount']?.toString() ?? '${merchants.length}', Icons.storefront_rounded)),
        const SizedBox(width: 10),
        Expanded(child: _statTile('Open now', stats['openNowCount']?.toString() ?? '—', Icons.bolt_rounded)),
        const SizedBox(width: 10),
        Expanded(child: _statTile('Delivery', '25-40 min', Icons.delivery_dining_rounded)),
      ],
    );
  }

  Widget _statTile(String labelText, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF7),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFD9D5C7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: const Color(0xFFE8613D)),
          const SizedBox(height: 6),
          Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          Text(labelText, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10, color: Color(0xFF6B7468))),
        ],
      ),
    );
  }

  Widget _featuredRail() {
    return SizedBox(
      height: 205,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: featured.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final merchant = featured[index];
          return _FeaturedMerchantCard(
            merchant: merchant,
            isFavorite: favorites.contains(merchant['id']?.toString()),
            onFavorite: () => _toggleFavorite(merchant['id']?.toString() ?? ''),
            onTap: () => _openMerchant(merchant['id']?.toString()),
          );
        },
      ),
    );
  }

  Widget _productRail(List<Map<String, dynamic>> items) {
    return SizedBox(
      height: 190,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final product = items[index];
          final merchant = asMap(product['merchant']);
          final image = product['imageUrl']?.toString();
          return SizedBox(
            width: 150,
            child: Card(
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => _openMerchant(merchant['id']?.toString() ?? product['merchantId']?.toString()),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      height: 92,
                      width: double.infinity,
                      child: image == null
                          ? const ColoredBox(color: Color(0xFFF0EAD9), child: Icon(Icons.local_mall_rounded, color: Color(0xFFE8613D)))
                          : Image.network(image, fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: Color(0xFFF0EAD9), child: Icon(Icons.local_mall_rounded, color: Color(0xFFE8613D)))),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(product['displayName']?.toString() ?? 'Item', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                          const SizedBox(height: 2),
                          Text(merchant['displayName']?.toString() ?? 'Merchant', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10, color: Color(0xFF6B7468))),
                          const SizedBox(height: 6),
                          Text(money(product['basePriceMinor'] as num?, product['currency']?.toString() ?? 'ETB'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _recentOrderRail() {
    return SizedBox(
      height: 86,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: recentlyOrdered.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final entry = recentlyOrdered[index];
          final merchant = asMap(entry['merchant'] ?? entry);
          return SizedBox(
            width: 230,
            child: Card(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: const Color(0xFFF0EAD9),
                  child: Text((merchant['displayName']?.toString() ?? 'S').characters.first, style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFFE8613D))),
                ),
                title: Text(merchant['displayName']?.toString() ?? 'Merchant', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                subtitle: Text('Order again', style: const TextStyle(fontSize: 11)),
                onTap: () => _openMerchant(merchant['id']?.toString()),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _allMerchantsHeader() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeader('All near you', '${merchants.length} merchants · ${location.split(',').first}'),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              FilterChip(
                label: const Text('Open now'),
                selected: openNow,
                onSelected: (value) {
                  setState(() => openNow = value);
                  _loadMerchants();
                },
              ),
              const SizedBox(width: 6),
              FilterChip(
                label: const Text('Favorites'),
                selected: favoritesOnly,
                onSelected: (value) {
                  setState(() => favoritesOnly = value);
                  _loadMerchants();
                },
              ),
              const SizedBox(width: 6),
              FilterChip(
                label: Text('Sort: ${_sortLabel(sort)}'),
                selected: sort != 'recommended',
                onSelected: (_) => _openFilters(),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _merchantsSection() {
    if (loadingList) {
      return Column(
        children: List.generate(3, (_) => const Padding(padding: EdgeInsets.only(bottom: 10), child: MerchantCardSkeleton())),
      );
    }
    if (error != null) return _errorState();
    if (merchants.isEmpty) {
      return EmptyState(
        icon: favoritesOnly ? Icons.favorite_border : Icons.storefront_outlined,
        title: favoritesOnly ? 'No favorites yet' : 'No merchants match',
        message: favoritesOnly
            ? 'Tap the heart on a merchant to save it here.'
            : 'Try another category, clear filters, or change your location.',
      );
    }
    return Column(
      children: merchants
          .map(
            (merchant) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: MerchantCard(
                merchant: merchant,
                isFavorite: favorites.contains(merchant['id']?.toString()),
                onFavoriteToggle: () => _toggleFavorite(merchant['id']?.toString() ?? ''),
                onTap: () => _openMerchant(merchant['id']?.toString()),
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _errorState() {
    return Column(
      children: [
        ErrorBanner(message: error ?? 'Something went wrong.'),
        const SizedBox(height: 10),
        FilledButton.tonalIcon(
          onPressed: _bootstrap,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Try again'),
        ),
      ],
    );
  }

  Widget _homeSkeleton() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SkeletonBox(width: double.infinity, height: 170, borderRadius: 22),
        const SizedBox(height: 18),
        const SkeletonBox(width: 180, height: 20),
        const SizedBox(height: 10),
        SizedBox(
          height: 205,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: 3,
            separatorBuilder: (_, _) => const SizedBox(width: 12),
            itemBuilder: (_, _) => const SkeletonBox(width: 220, height: 205, borderRadius: 18),
          ),
        ),
        const SizedBox(height: 18),
        ...List.generate(2, (_) => const Padding(padding: EdgeInsets.only(bottom: 10), child: MerchantCardSkeleton())),
      ],
    );
  }

  Widget _searchBody() {
    final results = asMap(searchResult);
    final items = asList(results['items']);
    final merchantsResult = asList(results['merchants']);
    final productsResult = asList(results['products']);
    final servicesResult = asList(results['services']);
    final suggestions = (results['suggestions'] as List? ?? const []).whereType<String>().toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (searchError != null) ErrorBanner(message: searchError!),
        if (searchResult.isEmpty && searchError == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 40),
            child: Center(child: CircularProgressIndicator()),
          ),
        if (suggestions.isNotEmpty) ...[
          Text('Suggestions', style: Theme.of(context).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: suggestions.take(6).map((term) => ActionChip(label: Text(term), onPressed: () => _commitSearch(term))).toList(),
          ),
          const SizedBox(height: 16),
        ],
        if (searchResult.isNotEmpty && items.isEmpty && searchError == null)
          const EmptyState(
            icon: Icons.search_off_rounded,
            title: 'No matches yet',
            message: 'Try a dish, store, product or service name.',
          )
        else ...[
          if (merchantsResult.isNotEmpty) ...[
            Text('Merchants', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            ...merchantsResult.map(
              (merchant) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: MerchantCard(
                  merchant: merchant,
                  isFavorite: favorites.contains(merchant['id']?.toString()),
                  onFavoriteToggle: () => _toggleFavorite(merchant['id']?.toString() ?? ''),
                  onTap: () => _openMerchant(merchant['id']?.toString()),
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (productsResult.isNotEmpty) ...[
            Text('Products', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            ...productsResult.map(
              (product) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Card(
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: const Color(0xFFF0EAD9),
                      child: const Icon(Icons.local_mall_rounded, color: Color(0xFFE8613D), size: 20),
                    ),
                    title: Text(product['displayName']?.toString() ?? 'Item', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(asMap(product['merchant'])['displayName']?.toString() ?? 'Merchant'),
                    trailing: Text(money(product['basePriceMinor'] as num?, product['currency']?.toString() ?? 'ETB'), style: const TextStyle(fontWeight: FontWeight.w800)),
                    onTap: () => _openMerchant(asMap(product['merchant'])['id']?.toString()),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (servicesResult.isNotEmpty) ...[
            Text('Services', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: servicesResult
                  .map(
                    (service) => ActionChip(
                      avatar: Icon(_categoryIcons[service['slug']?.toString()] ?? Icons.storefront_rounded, size: 16),
                      label: Text(service['displayName']?.toString() ?? 'Service'),
                      onPressed: () {
                        searchController.clear();
                        setState(() => searching = false);
                        _selectCategory(service['slug']?.toString());
                      },
                    ),
                  )
                  .toList(),
            ),
          ],
        ],
      ],
    );
  }

  String _sortLabel(String value) {
    return const {
          'recommended': 'Recommended',
          'distance': 'Nearest',
          'rating': 'Top rated',
          'eta': 'Fastest',
          'name': 'A-Z',
        }[value] ??
        'Recommended';
  }

  Color? _parseColor(String? value) {
    if (value == null) return null;
    final hex = value.replaceFirst('#', '');
    if (hex.length != 6) return null;
    final parsed = int.tryParse(hex, radix: 16);
    return parsed == null ? null : Color(0xFF000000 | parsed);
  }
}

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({required this.icon, required this.label, required this.selected, required this.onTap, this.badge});

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Column(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(
                    color: selected ? const Color(0xFF20261F) : const Color(0xFFFFFDF7),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: selected ? const Color(0xFF20261F) : const Color(0xFFD9D5C7)),
                  ),
                  child: Icon(icon, color: selected ? Colors.white : const Color(0xFF20261F), size: 24),
                ),
                if (badge != null && badge != '0')
                  Positioned(
                    right: -4,
                    top: -4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                      decoration: BoxDecoration(color: const Color(0xFFE8613D), borderRadius: BorderRadius.circular(8)),
                      child: Text(badge!, style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 5),
            SizedBox(
              width: 62,
              child: Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 10, fontWeight: selected ? FontWeight.w800 : FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeaturedMerchantCard extends StatelessWidget {
  const _FeaturedMerchantCard({required this.merchant, required this.isFavorite, required this.onFavorite, required this.onTap});

  final Map<String, dynamic> merchant;
  final bool isFavorite;
  final VoidCallback onFavorite;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cover = merchant['coverImageUrl'] ?? merchant['logoUrl'];
    final rating = merchant['rating']?.toString() ?? '4.8';
    final eta = merchant['etaMinMinutes'] != null && merchant['etaMaxMinutes'] != null
        ? '${merchant['etaMinMinutes']}-${merchant['etaMaxMinutes']} min'
        : '25-35 min';
    return SizedBox(
      width: 224,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    height: 118,
                    width: double.infinity,
                    child: cover == null
                        ? const ColoredBox(color: Color(0xFFF0EAD9), child: Icon(Icons.storefront_rounded, size: 42, color: Color(0xFFE8613D)))
                        : Image.network(cover.toString(), fit: BoxFit.cover, errorBuilder: (_, _, _) => const ColoredBox(color: Color(0xFFF0EAD9), child: Icon(Icons.storefront_rounded, size: 42, color: Color(0xFFE8613D)))),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(merchant['displayName']?.toString() ?? 'Merchant', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            const Icon(Icons.star_rounded, size: 15, color: Color(0xFFE8613D)),
                            const SizedBox(width: 2),
                            Text(rating, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
                            const SizedBox(width: 8),
                            const Icon(Icons.access_time_rounded, size: 13, color: Color(0xFF6B7468)),
                            const SizedBox(width: 2),
                            Expanded(child: Text(eta, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: Color(0xFF6B7468)))),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              Positioned(
                right: 8,
                top: 8,
                child: Material(
                  color: Colors.white.withValues(alpha: 0.92),
                  shape: const CircleBorder(),
                  child: IconButton(
                    visualDensity: VisualDensity.compact,
                    iconSize: 18,
                    onPressed: onFavorite,
                    icon: Icon(isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded, color: isFavorite ? const Color(0xFFE8613D) : const Color(0xFF20261F)),
                  ),
                ),
              ),
              if (merchant['isFeatured'] == true)
                Positioned(
                  left: 8,
                  top: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(color: const Color(0xFF20261F), borderRadius: BorderRadius.circular(7)),
                    child: const Text('FEATURED', style: TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w800, letterSpacing: 0.6)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

