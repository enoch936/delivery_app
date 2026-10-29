import 'package:flutter/material.dart';

class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFBEAE7),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFEFC7C1)),
      ),
      child: Text(
        message,
        style: const TextStyle(color: Color(0xFFA63A32), fontSize: 13),
      ),
    );
  }
}