import 'package:customer_mobile/shared/domain/money.dart';

class CartItem {
  CartItem({
    required this.id,
    required this.displayName,
    required this.quantity,
    required this.lineTotalMinor,
    required this.currency,
    this.stockIssue,
  });

  final String id;
  final String displayName;
  final int quantity;
  final num lineTotalMinor;
  final String? currency;
  final String? stockIssue;

  factory CartItem.fromJson(Map<String, dynamic> json) => CartItem(
        id: json['id'] as String,
        displayName: json['displayName'] as String,
        quantity: (json['quantity'] as num).toInt(),
        lineTotalMinor: json['lineTotalMinor'] as num,
        currency: json['currency'] as String?,
        stockIssue: json['stockIssue'] as String?,
      );

  String get formattedTotal => money(lineTotalMinor, currency);
}

class CartModel {
  CartModel({
    required this.items,
    required this.itemsSubtotalMinor,
    required this.merchantId,
    required this.merchantName,
    required this.currency,
  });

  final List<CartItem> items;
  final num itemsSubtotalMinor;
  final String merchantId;
  final String merchantName;
  final String currency;

  factory CartModel.fromJson(Map<String, dynamic> json) => CartModel(
        items: asList(json['items']).map(CartItem.fromJson).toList(),
        itemsSubtotalMinor: json['itemsSubtotalMinor'] as num,
        merchantId: json['merchantId'] as String,
        merchantName: json['merchantName'] as String,
        currency: json['currency'] as String,
      );

  bool get isEmpty => items.isEmpty;
  String get formattedSubtotal => money(itemsSubtotalMinor, currency);
}