import '../../shared/domain/models.dart';
import '../../shared/infrastructure/api_client.dart';

class AuthRepository {
  AuthRepository(this._client);

  final ApiClient _client;

  Session? get session => _client.session;
  String? get accessToken => _client.accessToken;

  Future<Map<String, dynamic>> requestOtp(String phone) => _client.requestOtp(phone);

  Future<Session> verifyOtp(String phone, String code, String challengeId) =>
      _client.verifyOtp(phone, code, challengeId);

  Future<void> signOut() => _client.signOut();

  Future<void> restoreSession() => _client.restoreSession();

  Future<void> startSync() => _client.startSync();

  ValueNotifier<int> get pendingSync => _client.pendingSync;

  Future<int> flushQueue() => _client.flushQueue();

  void dispose() => _client.dispose();
}
