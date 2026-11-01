import 'package:flutter/material.dart';

import '../main.dart';
import 'account_ui.dart';

class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key, required this.client});

  final ApiClient client;

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  List<Map<String, dynamic>> tickets = [];
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
      final result = asMap(await widget.client.get('/v1/support/tickets?limit=30'));
      if (mounted) setState(() => tickets = asList(result['items']));
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _openTicket(String ticketId) async {
    final screen = SupportTicketScreen(client: widget.client, ticketId: ticketId);
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Support')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: loading
            ? const AccountLoading()
            : error != null
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  AccountEmpty(icon: Icons.support_agent_outlined, title: 'Could not load tickets', message: error!),
                  const SizedBox(height: 20),
                ],
              )
            : tickets.isEmpty
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  AccountEmpty(
                    icon: Icons.support_agent_outlined,
                    title: 'No support tickets yet',
                    message: 'Open a ticket when an order needs help, or start one from the Help section.',
                  ),
                  const SizedBox(height: 20),
                ],
              )
            : ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                itemCount: tickets.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final ticket = tickets[index];
                  return _SupportTicketCard(ticket: ticket, onOpen: () => _openTicket(ticket['id']?.toString() ?? ''));
                },
              ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await Navigator.of(context).push<dynamic>(
            MaterialPageRoute<void>(builder: (_) => SupportNewTicketScreen(client: widget.client, orderId: null)),
          );
          if (created is String && created.isNotEmpty && mounted) {
            await _openTicket(created);
          }
        },
        icon: const Icon(Icons.add_rounded),
        label: const Text('New ticket'),
      ),
    );
  }
}

class _SupportTicketCard extends StatelessWidget {
  const _SupportTicketCard({required this.ticket, required this.onOpen});

  final Map<String, dynamic> ticket;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        onTap: onOpen,
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: const Color(0xFFE8613D).withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(Icons.support_agent_outlined, color: Color(0xFFE8613D)),
        ),
        title: Text(
          ticket['subject']?.toString() ?? 'Support request',
          style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Text(
              ticket['orderNumber']?.toString() ?? 'General inquiry',
              style: TextStyle(fontSize: 12, color: const Color(0xFF6B7468), fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 2),
            Text(
              'Updated ${shortDate(ticket['updatedAt']?.toString())}',
              style: const TextStyle(fontSize: 11, color: Color(0xFF6B7468)),
            ),
          ],
        ),
        trailing: StatusPill(
          label: ticket['status']?.toString() ?? 'OPEN',
          color: _supportStatusColor(ticket['status']?.toString()),
        ),
      ),
    );
  }
}

class SupportTicketScreen extends StatefulWidget {
  const SupportTicketScreen({super.key, required this.client, required this.ticketId});

  final ApiClient client;
  final String ticketId;

  @override
  State<SupportTicketScreen> createState() => _SupportTicketScreenState();
}

class _SupportTicketScreenState extends State<SupportTicketScreen> {
  Map<String, dynamic>? _ticket;
  List<Map<String, dynamic>> messages = [];
  bool loading = true;
  bool sending = false;
  String? error;
  final TextEditingController _draft = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = asMap(await widget.client.get('/v1/support/tickets/${widget.ticketId}'));
      if (!mounted) return;
      setState(() {
        _ticket = result;
        messages = asList(result['messages']);
      });
    } catch (cause) {
      if (mounted) setState(() => error = cause.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _send() async {
    final body = _draft.text.trim();
    if (body.isEmpty || sending) return;
    setState(() => sending = true);
    try {
      final result = asMap(await widget.client.post('/v1/support/tickets/${widget.ticketId}/messages', {'body': body}));
      if (!mounted) return;
      _draft.clear();
      await _load();
      if (mounted && result['sent'] != true) {
        showAccountMessage(context, 'Your message was sent.');
      }
    } catch (cause) {
      if (mounted) showAccountMessage(context, cause.toString());
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ticket = _ticket;
    return Scaffold(
      appBar: AppBar(title: Text(ticket?['subject']?.toString() ?? 'Support ticket')),
      body: loading
          ? const AccountLoading()
          : error != null
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                AccountEmpty(icon: Icons.support_agent_outlined, title: 'Could not load ticket', message: error!),
                const SizedBox(height: 20),
              ],
            )
          : Column(
              children: [
                if (ticket != null)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          ticket['subject']?.toString() ?? 'Support request',
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            StatusPill(
                              label: ticket['status']?.toString() ?? 'OPEN',
                              color: _supportStatusColor(ticket['status']?.toString()),
                            ),
                            const SizedBox(width: 8),
                            StatusPill(
                              label: ticket['priority']?.toString() ?? 'NORMAL',
                              color: _supportPriorityColor(ticket['priority']?.toString()),
                            ),
                          ],
                        ),
                        if (ticket['orderNumber'] != null) ...[
                          const SizedBox(height: 6),
                          Text(
                            'Order ${ticket['orderNumber']}',
                            style: TextStyle(fontSize: 12, color: const Color(0xFF6B7468), fontWeight: FontWeight.w600),
                          ),
                        ],
                      ],
                    ),
                  ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                      children: [
                        if (messages.isEmpty)
                          const Padding(
                            padding: EdgeInsets.only(top: 24),
                            child: Center(child: Text('No replies yet. Send a message and we will respond shortly.')),
                          )
                        else
                          ...messages.map(
                            (message) => _SupportMessageBubble(
                              message: message,
                              mine: message['senderUserId']?.toString() == widget.client.session?.user['id']?.toString(),
                            ),
                          ),
                        const SizedBox(height: 12),
                      ],
                    ),
                  ),
                ),
                SafeArea(
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _draft,
                            textInputAction: TextInputAction.send,
                            onSubmitted: (_) => _send(),
                            decoration: InputDecoration(
                              hintText: 'Write a message...',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        FilledButton(
                          onPressed: sending ? null : _send,
                          style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE8613D)),
                          child: sending
                              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.send_rounded),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _SupportMessageBubble extends StatelessWidget {
  const _SupportMessageBubble({required this.message, required this.mine});

  final Map<String, dynamic> message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: const BoxConstraints(maxWidth: 300),
        decoration: BoxDecoration(
          color: mine ? const Color(0xFFE8613D) : const Color(0xFFF0EAD9),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          message['body']?.toString() ?? '',
          style: TextStyle(color: mine ? Colors.white : const Color(0xFF20261F), fontSize: 13, height: 1.35),
        ),
      ),
    );
  }
}

class SupportNewTicketScreen extends StatefulWidget {
  const SupportNewTicketScreen({super.key, required this.client, required this.orderId});

  final ApiClient client;
  final String? orderId;

  @override
  State<SupportNewTicketScreen> createState() => _SupportNewTicketScreenState();
}

class _SupportNewTicketScreenState extends State<SupportNewTicketScreen> {
  final _subjectController = TextEditingController();
  final _messageController = TextEditingController();
  String _category = 'general';
  String _priority = 'NORMAL';
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _subjectController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final subject = _subjectController.text.trim();
    final message = _messageController.text.trim();
    if (subject.length < 3 || subject.length > 160) {
      setState(() => _error = 'Subject must be 3–160 characters.');
      return;
    }
    if (message.isEmpty || message.length > 4000) {
      setState(() => _error = 'Message must be 1–4000 characters.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = asMap(await widget.client.post('/v1/support/tickets', {
        'subject': subject,
        'category': _category,
        'orderId': widget.orderId,
        'priority': _priority,
        'message': message,
      }));
      if (!mounted) return;
      final ticketId = result['id']?.toString();
      if (ticketId == null || ticketId.isEmpty) {
        setState(() => _error = 'Ticket was not created.');
        return;
      }
      Navigator.of(context).pop<String>(ticketId);
    } catch (cause) {
      if (mounted) setState(() => _error = cause.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New support ticket')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          TextField(
            controller: _subjectController,
            decoration: const InputDecoration(labelText: 'Subject', hintText: 'What is this about? (3–160 characters)'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _category,
            decoration: const InputDecoration(labelText: 'Category'),
            items: const [
              DropdownMenuItem(value: 'general', child: Text('General inquiry')),
              DropdownMenuItem(value: 'order', child: Text('Order problem')),
              DropdownMenuItem(value: 'delivery', child: Text('Delivery issue')),
              DropdownMenuItem(value: 'payment', child: Text('Payment issue')),
              DropdownMenuItem(value: 'refund', child: Text('Refund request')),
              DropdownMenuItem(value: 'other', child: Text('Something else')),
            ],
            onChanged: (value) => setState(() => _category = value ?? _category),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _priority,
            decoration: const InputDecoration(labelText: 'Priority'),
            items: const [
              DropdownMenuItem(value: 'LOW', child: Text('Low')),
              DropdownMenuItem(value: 'NORMAL', child: Text('Normal')),
              DropdownMenuItem(value: 'HIGH', child: Text('High')),
              DropdownMenuItem(value: 'URGENT', child: Text('Urgent')),
            ],
            onChanged: (value) => setState(() => _priority = value ?? _priority),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _messageController,
            maxLines: 6,
            maxLength: 4000,
            decoration: const InputDecoration(labelText: 'Message', hintText: 'Describe the issue or question (1–4000 characters)'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Color(0xFFA63A32), fontSize: 13)),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _saving ? null : _create,
            child: _saving
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Submit ticket'),
          ),
        ],
      ),
    );
  }
}

Color _supportStatusColor(String? status) {
  switch (status) {
    case 'OPEN':
      return const Color(0xFFE8613D);
    case 'IN_PROGRESS':
      return const Color(0xFF0B6E99);
    case 'RESOLVED':
      return const Color(0xFF2E7D5B);
    case 'CLOSED':
      return const Color(0xFF6B7468);
    default:
      return const Color(0xFF6B7468);
  }
}

Color _supportPriorityColor(String? priority) {
  switch (priority) {
    case 'URGENT':
      return const Color(0xFFA63A32);
    case 'HIGH':
      return const Color(0xFFB26A00);
    case 'NORMAL':
      return const Color(0xFF4A5D52);
    case 'LOW':
      return const Color(0xFF6B7468);
    default:
      return const Color(0xFF6B7468);
  }
}
