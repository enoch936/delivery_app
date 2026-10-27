import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

class AppLocalizations {
  const AppLocalizations(this.locale);

  final Locale locale;

  static const supportedLocales = [Locale('en'), Locale('am')];

  static const localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    AppLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ];

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations) ?? const AppLocalizations(Locale('en'));

  bool get _amharic => locale.languageCode == 'am';

  String _t(String english, String amharic) => _amharic ? amharic : english;

  String get discover => _t('Discover', 'ፈልግ');
  String get orders => _t('Orders', 'ትዕዛዞች');
  String get profile => _t('Profile', 'መገለጫ');
  String get cart => _t('Cart', 'ጋሪ');
  String get signOut => _t('Sign out', 'ውጣ');
  String get helpAndSupport => _t('Help and support', 'እገዛ እና ድጋፍ');
  String get helpSubtitle => _t('In-app support is available from order details.', 'የውስጠ-መተግበሪያ ድጋፍ ከትዕዛዝ ዝርዝር ይገኛል።');
  String get yourCart => _t('Your cart', 'የእርስዎ ጋሪ');
  String get language => _t('Language', 'ቋንቋ');
  String get english => _t('English', 'እንግሊዝኛ');
  String get amharic => _t('Amharic', 'አማርኛ');
  String get connectedTo => _t('Connected to', 'ተገናኝቷል');
  String get signInTitle => _t('Good food,\nright now.', 'ጣፋጭ ምግብ፣\nአሁኑኑ።');
  String get signInSubtitle => _t(
        'Sign in with the phone number you use for deliveries. We will send a one-time code.',
        'በማድረጊያ የሚጠቀሙበትን የስልክ ቁጥር ያስገቡ። የአንድ ጊዜ ኮድ እንልካለን።',
      );
  String enterCodeTo(String phone) => _t('Enter the code sent to $phone.', 'ወደ $phone የተላከውን ኮድ ያስገቡ።');
  String get courierSignInTitle => _t('Ready to\nhit the road?', 'ለመንገድ\nተዘጋጅተዋል?');
  String get courierSignInSubtitle => _t('Sign in with your courier phone number. We will text you a one-time code.', 'በማድረሻ የስልክ ቁጥርዎ ይግቡ። የአንድ ጊዜ ኮድ በፅሁፍ እንልካለን።');
  String get courierAccessNote => _t('Courier access is reviewed by operations. You must be approved and online to receive offers.', 'የማድረሻ መዳረሻ በኦፕሬሽን ይገመገማል። ቅናሾችን ለመቀበል መፀደቅ እና በመስመር ላይ መሆን ያስፈልጋል።');
  String get phoneNumber => _t('Phone number', 'የስልክ ቁጥር');
  String get oneTimeCode => _t('One-time code', 'የአንድ ጊዜ ኮድ');
  String get sendSignInCode => _t('Send sign-in code', 'የመግቢያ ኮድ ላክ');
  String get sending => _t('Sending…', 'በመላክ ላይ…');
  String get verifying => _t('Verifying…', 'በማረጋገጥ ላይ…');
  String get continueLabel => _t('Continue', 'ቀጥል');
  String get differentNumber => _t('Use a different number', 'ሌላ ቁጥር ተጠቀም');
  String get terms => _t(
        'By continuing you agree to the delivery_app terms and privacy policy.',
        'በመቀጠል የdelivery_app ውሎችን እና የግላዊነት መመሪያን ተቀብለዋል።',
      );
  String get savedOffline => _t('Saved offline. It will sync automatically.', 'በኦፍላይን ተቀምጧል። በራስ-ሰር ይመሳሰላል።');
  String get offlineMode => _t('Offline: showing saved data', 'ኦፍላይን፦ የተቀመጠ ውሂብ በማሳየት ላይ');
  String get pendingSync => _t('Pending sync', 'በመመሳሰል ላይ');
  String get today => _t('Today', 'ዛሬ');
  String get earnings => _t('Earnings', 'ገቢ');
  String get refresh => _t('Refresh', 'አድስ');
  String get cashSelected => _t('Cash payment selected. Pay the courier on delivery.', 'የጥሬ ገንዘብ ክፍያ ተመርጧል። በማድረሻ ጊዜ ለማድረሻው ይክፈሉ።');
  String get sandboxPaymentCompleted => _t('Sandbox payment completed.', 'የሙከራ ክፍያ ተጠናቅቋል።');
  String get liveLocationSent => _t('Live location sent.', 'ቀጥታ አካባቢ ተልኳል።');
  String get locationServiceRequired => _t('Turn on location services to receive deliveries.', 'ማድረሻዎችን ለመቀበል የአካባቢ አገልግሎትን ያብሩ።');
  String get locationPermissionRequired => _t('Location permission is required while you are online.', 'በመስመር ላይ ሳለ የአካባቢ ፈቃድ ያስፈልጋል።');

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => ['en', 'am'].contains(locale.languageCode);

  @override
  Future<AppLocalizations> load(Locale locale) => SynchronousFuture(AppLocalizations(locale));

  @override
  bool shouldReload(covariant LocalizationsDelegate<AppLocalizations> old) => false;
}
