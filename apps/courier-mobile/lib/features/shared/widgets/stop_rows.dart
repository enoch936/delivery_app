import 'package:flutter/material.dart';

class StopRow extends StatelessWidget {
  const StopRow({super.key, required this.icon, required this.title, required this.name, this.address});
  final IconData icon;
  final String title;
  final String name;
  final String? address;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 19, color: const Color(0xFF2F6B4F)),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 11, color: Color(0xFF6B7468), fontWeight: FontWeight.w700)),
              Text(name, style: const TextStyle(fontWeight: FontWeight.w700)),
              if (address != null && address!.isNotEmpty)
                Text(address!, style: const TextStyle(fontSize: 12, color: Color(0xFF6B7468))),
            ],
          ),
        ),
      ],
    );
  }
}
