import 'formatters.dart';

class Session {
  Session({required this.accessToken, required this.refreshToken, required this.user});

  final String accessToken;
  final String refreshToken;
  final Map<String, dynamic> user;

  factory Session.fromJson(Map<String, dynamic> json) => Session(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
        user: asMap(json['user']),
      );

  Map<String, dynamic> toJson() => {
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'user': user,
      };
}

class ApiException implements Exception {
  ApiException(this.message, [this.statusCode = 0]);
  final String message;
  final int statusCode;

  @override
  String toString() => message;
}
