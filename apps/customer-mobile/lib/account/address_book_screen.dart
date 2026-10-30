import 'package:flutter/material.dart';

import '../main.dart';
import 'account_ui.dart';

class AddressBookScreen extends StatefulWidget {
  const AddressBookScreen({super.key, required this.client});

  final ApiClient client;

  @override
  State<AddressBookScreen> createState() => _AddressBookScreenState();
}

class _AddressBookScreenState extends State<AddressBookScreen> {
  List<Map<String, dynamic>> addresses = [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.get('/v1/addresses'));
      if (!mounted) return;
      setState(() => addresses = asList(result['items']));
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _openForm([Map<String, dynamic>? address]) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AddressFormScreen(
          client: widget.client,
          address: address,
        ),
      ),
    );
    if (changed == true) await _load();
  }

  Future<void> _setDefault(Map<String, dynamic> address) async {
    try {
      await widget.client.patch('/v1/addresses/${address['id']}', {'isDefault': true});
      await _load();
      if (mounted) showAccountMessage(context, 'Default address updated.');
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    }
  }

  Future<void> _delete(Map<String, dynamic> address) async {
    final confirmed = await confirmAccountAction(
      context,
      title: 'Delete this address?',
      message: '${address['label']} will be removed from your saved addresses and cannot be selected at checkout.',
      confirmLabel: 'Delete address',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    try {
      await widget.client.delete('/v1/addresses/${address['id']}');
      await _load();
      if (mounted) showAccountMessage(context, 'Address deleted.');
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Saved addresses')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add_location_alt_outlined),
        label: const Text('Add address'),
      ),
      body: Builder(
        builder: (context) {
          if (loading) return const AccountLoading();
          if (error != null) {
            return AccountEmpty(
              icon: Icons.cloud_off_outlined,
              title: 'Could not load addresses',
              message: error!,
            );
          }
          if (addresses.isEmpty) {
            return const AccountEmpty(
              icon: Icons.location_on_outlined,
              title: 'No saved addresses',
              message: 'Add your home, work or another delivery point to check out faster.',
            );
          }
          return RefreshIndicator(
            onRefresh: _load,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
              itemCount: addresses.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final address = addresses[index];
                final isDefault = address['isDefault'] == true;
                final instructions = address['deliveryInstructions']?.toString();
                return Container(
                  decoration: BoxDecoration(
                    color: accountSurface,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: isDefault ? accountAccent.withValues(alpha: 0.5) : accountBorder),
                  ),
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.location_on, color: accountAccent, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(address['label']?.toString() ?? 'Address',
                                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                          ),
                          if (isDefault) const StatusPill(label: 'Default', color: accountAccent),
                          PopupMenuButton<String>(
                            onSelected: (value) {
                              if (value == 'edit') _openForm(address);
                              if (value == 'default') _setDefault(address);
                              if (value == 'delete') _delete(address);
                            },
                            itemBuilder: (_) => [
                              const PopupMenuItem(value: 'edit', child: Text('Edit')),
                              if (!isDefault) const PopupMenuItem(value: 'default', child: Text('Set as default')),
                              const PopupMenuItem(value: 'delete', child: Text('Delete')),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(address['addressLine']?.toString() ?? '', style: const TextStyle(color: accountMuted, height: 1.4)),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 16,
                        runSpacing: 6,
                        children: [
                          _meta(Icons.person_outline, address['recipientName']?.toString() ?? ''),
                          _meta(Icons.call_outlined, address['phoneE164']?.toString() ?? ''),
                        ],
                      ),
                      if (instructions != null && instructions.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: accountCanvas,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.sticky_note_2_outlined, size: 15, color: accountMuted),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(instructions, style: const TextStyle(color: accountMuted, fontSize: 12, height: 1.35)),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }

  Widget _meta(IconData icon, String text) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: accountMuted),
        const SizedBox(width: 4),
        Text(text, style: const TextStyle(color: accountMuted, fontSize: 12)),
      ],
    );
  }
}

class AddressFormScreen extends StatefulWidget {
  const AddressFormScreen({super.key, required this.client, this.address});

  final ApiClient client;
  final Map<String, dynamic>? address;

  @override
  State<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends State<AddressFormScreen> {
  final formKey = GlobalKey<FormState>();
  late final TextEditingController label;
  late final TextEditingController recipient;
  late final TextEditingController phone;
  late final TextEditingController line;
  late final TextEditingController instructions;
  late bool isDefault;
  bool busy = false;

  bool get editing => widget.address != null;

  @override
  void initState() {
    super.initState();
    final address = widget.address ?? const <String, dynamic>{};
    label = TextEditingController(text: address['label']?.toString() ?? '');
    recipient = TextEditingController(text: address['recipientName']?.toString() ?? '');
    phone = TextEditingController(text: address['phoneE164']?.toString() ?? '');
    line = TextEditingController(text: address['addressLine']?.toString() ?? '');
    instructions = TextEditingController(text: address['deliveryInstructions']?.toString() ?? '');
    isDefault = address['isDefault'] == true;
  }

  @override
  void dispose() {
    label.dispose();
    recipient.dispose();
    phone.dispose();
    line.dispose();
    instructions.dispose();
    super.dispose();
  }

  Future<void> save() async {
    if (!(formKey.currentState?.validate() ?? false)) return;
    setState(() => busy = true);
    final payload = {
      'label': label.text.trim(),
      'recipientName': recipient.text.trim(),
      'phoneE164': phone.text.trim(),
      'addressLine': line.text.trim(),
      'deliveryInstructions': instructions.text.trim().isEmpty ? null : instructions.text.trim(),
      'isDefault': isDefault,
    };
    try {
      if (editing) {
        await widget.client.patch('/v1/addresses/${widget.address!['id']}', payload);
      } else {
        await widget.client.post('/v1/addresses', payload);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit address' : 'New address')),
      body: Form(
        key: formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            TextFormField(
              controller: label,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Label', hintText: 'Home, Work, Parents…'),
              validator: (value) => (value ?? '').trim().isEmpty ? 'Add a short label.' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: recipient,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Recipient name'),
              validator: (value) => (value ?? '').trim().length < 2 ? 'Enter the recipient name.' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: phone,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Phone number', hintText: '+2519XXXXXXXX'),
              validator: (value) {
                final text = (value ?? '').trim();
                return RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(text) ? null : 'Use international format, e.g. +251911234567.';
              },
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: line,
              textInputAction: TextInputAction.next,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Address', hintText: 'Building, street, area, city'),
              validator: (value) => (value ?? '').trim().length < 5 ? 'Enter a complete address.' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: instructions,
              maxLines: 3,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'Delivery instructions (optional)',
                hintText: 'Gate code, floor, landmark, call on arrival…',
                alignLabelWithHint: true,
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: isDefault,
              activeThumbColor: accountAccent,
              title: const Text('Use as my default address'),
              subtitle: const Text('Selected automatically at checkout.'),
              onChanged: (value) => setState(() => isDefault = value),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: busy ? null : save, child: Text(busy ? 'Saving…' : 'Save address')),
          ],
        ),
      ),
    );
  }
}
