import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'fr' | 'ar';

type Entry = { fr: string; ar: string };

/**
 * Internationalisation maison (aucune dependance externe).
 * Le francais est la langue de reference ; l'arabe est traduit pour la navigation,
 * les pages publiques et les libelles metier. La direction du document bascule en RTL.
 */
const DICT: Record<string, Entry> = {
  'app.name': { fr: 'SOS Sang', ar: 'SOS دم' },
  'app.tagline': { fr: 'Chaque goutte compte.', ar: 'كل قطرة مهمة.' },
  'nav.home': { fr: 'Accueil', ar: 'الرئيسية' },
  'nav.how': { fr: 'Fonctionnement', ar: 'كيف يعمل' },
  'nav.groups': { fr: 'Groupes sanguins', ar: 'فصائل الدم' },
  'nav.contact': { fr: 'Contact', ar: 'اتصل بنا' },
  'nav.privacy': { fr: 'Confidentialité', ar: 'الخصوصية' },
  'nav.login': { fr: 'Connexion', ar: 'تسجيل الدخول' },
  'nav.register': { fr: 'Créer un compte', ar: 'إنشاء حساب' },
  'nav.becomeDonor': { fr: 'Devenir donneur', ar: 'كن متبرعاً' },
  'nav.hospitalSpace': { fr: 'Espace hôpital', ar: 'فضاء المستشفى' },
  'nav.logout': { fr: 'Se déconnecter', ar: 'تسجيل الخروج' },
  'nav.dashboard': { fr: 'Tableau de bord', ar: 'لوحة التحكم' },
  'nav.alerts': { fr: 'Alertes', ar: 'التنبيهات' },
  'nav.history': { fr: 'Historique', ar: 'السجل' },
  'nav.profile': { fr: 'Mon profil', ar: 'ملفي' },
  'nav.urgences': { fr: 'Urgences', ar: 'الحالات المستعجلة' },
  'nav.newUrgence': { fr: 'Déclarer une urgence', ar: 'الإعلان عن حالة مستعجلة' },
  'nav.stock': { fr: 'Stocks', ar: 'المخزون' },
  'nav.stats': { fr: 'Statistiques', ar: 'الإحصائيات' },
  'nav.users': { fr: 'Utilisateurs', ar: 'المستخدمون' },
  'nav.hospitals': { fr: 'Hôpitaux', ar: 'المستشفيات' },
  'nav.notifications': { fr: 'Notifications', ar: 'الإشعارات' },
  'nav.audit': { fr: 'Journal d’audit', ar: 'سجل التدقيق' },
  'nav.services': { fr: 'État des services', ar: 'حالة الخدمات' },
  'common.loading': { fr: 'Chargement…', ar: 'جار التحميل…' },
  'common.save': { fr: 'Enregistrer', ar: 'حفظ' },
  'common.cancel': { fr: 'Annuler', ar: 'إلغاء' },
  'common.close': { fr: 'Fermer', ar: 'إغلاق' },
  'common.confirm': { fr: 'Confirmer', ar: 'تأكيد' },
  'common.back': { fr: 'Retour', ar: 'رجوع' },
  'common.retry': { fr: 'Réessayer', ar: 'إعادة المحاولة' },
  'common.search': { fr: 'Rechercher', ar: 'بحث' },
  'common.all': { fr: 'Tous', ar: 'الكل' },
  'common.none': { fr: 'Aucun', ar: 'لا يوجد' },
  'common.optional': { fr: 'facultatif', ar: 'اختياري' },
  'common.required': { fr: 'obligatoire', ar: 'مطلوب' },
  'common.distance': { fr: 'Distance', ar: 'المسافة' },
  'common.priority': { fr: 'Priorité', ar: 'الأولوية' },
  'common.status': { fr: 'Statut', ar: 'الحالة' },
  'common.actions': { fr: 'Actions', ar: 'الإجراءات' },
  'common.empty': { fr: 'Aucune donnée pour le moment.', ar: 'لا توجد بيانات حالياً.' },
  'common.error': { fr: 'Une erreur est survenue.', ar: 'حدث خطأ.' },
  'common.simulated': { fr: 'Simulé', ar: 'محاكاة' },
  'common.demoData': { fr: 'Données de démonstration', ar: 'بيانات تجريبية' },
  'priority.CRITICAL': { fr: 'Critique', ar: 'حرجة' },
  'priority.HIGH': { fr: 'Élevée', ar: 'عالية' },
  'priority.NORMAL': { fr: 'Normale', ar: 'عادية' },
  'status.OPEN': { fr: 'Ouverte', ar: 'مفتوحة' },
  'status.COVERED': { fr: 'Couverte', ar: 'مغطاة' },
  'status.CLOSED': { fr: 'Clôturée', ar: 'مغلقة' },
  'status.CANCELLED': { fr: 'Annulée', ar: 'ملغاة' },
  'resp.CONTACTED': { fr: 'Contacté', ar: 'تم التواصل' },
  'resp.COMING': { fr: 'En route', ar: 'في الطريق' },
  'resp.CONFIRMED': { fr: 'Confirmé', ar: 'مؤكد' },
  'resp.DECLINED': { fr: 'Indisponible', ar: 'غير متاح' },
  'resp.CANCELLED': { fr: 'Annulé', ar: 'ملغى' },
  'home.eyebrow': { fr: 'Plateforme solidaire de don de sang', ar: 'منصة تضامنية للتبرع بالدم' },
  'home.title': { fr: 'Un besoin urgent. Des donneurs proches. En quelques minutes.', ar: 'حاجة عاجلة. متبرعون قريبون. في دقائق.' },
  'home.subtitle': {
    fr: 'SOS Sang relie les hôpitaux qui manquent de sang aux donneurs compatibles, disponibles et proches — sans exposer votre position précise.',
    ar: 'تربط SOS دم المستشفيات التي تحتاج إلى الدم بالمتبرعين المتوافقين والمتاحين والقريبين، دون الكشف عن موقعك الدقيق.',
  },
  'home.ctaDonor': { fr: 'Devenir donneur', ar: 'كن متبرعاً' },
  'home.ctaHospital': { fr: 'Espace hôpital', ar: 'فضاء المستشفى' },
  'home.statUrgences': { fr: 'urgences déclarées', ar: 'حالة مستعجلة' },
  'home.statDonors': { fr: 'donneurs mobilisés', ar: 'متبرع تمت تعبئته' },
  'home.statHospitals': { fr: 'hôpitaux engagés', ar: 'مستشفى مشارك' },
  'home.statDelay': { fr: 'délai moyen de mobilisation', ar: 'متوسط زمن التعبئة' },
  'home.howTitle': { fr: 'Comment fonctionne SOS Sang', ar: 'كيف تعمل منصة SOS دم' },
  'home.howSubtitle': {
    fr: 'Un parcours simple, pensé pour l’urgence réelle : de la déclaration à la poche de sang, chaque étape est traçable.',
    ar: 'مسار بسيط مصمم للحالات الحقيقية: من الإعلان إلى كيس الدم، كل خطوة قابلة للتتبع.',
  },
  'home.step1Title': { fr: 'L’hôpital déclare', ar: 'المستشفى يعلن' },
  'home.step1Text': {
    fr: 'Groupe requis, nombre de poches, priorité et échéance. La demande est validée côté serveur.',
    ar: 'الفصيلة المطلوبة، عدد الأكياس، الأولوية والأجل. يتم التحقق من الطلب على الخادم.',
  },
  'home.step2Title': { fr: 'Le moteur sélectionne', ar: 'المحرك يختار' },
  'home.step2Text': {
    fr: 'Compatibilité, disponibilité, éligibilité puis tri par distance et fiabilité documentée.',
    ar: 'التوافق، التوفر، الأهلية ثم الترتيب حسب المسافة والموثوقية الموثقة.',
  },
  'home.step3Title': { fr: 'Le donneur répond', ar: 'المتبرع يرد' },
  'home.step3Text': {
    fr: '« J’arrive » ou « Je ne peux pas ». Les places sont attribuées de façon atomique.',
    ar: '«سآتي» أو «لا أستطيع». يتم تخصيص الأماكن بشكل ذري دون تكرار.',
  },
  'home.step4Title': { fr: 'L’hôpital confirme', ar: 'المستشفى يؤكد' },
  'home.step4Text': {
    fr: 'Le tableau de bord se met à jour en temps réel, puis l’urgence est clôturée et les dons enregistrés.',
    ar: 'تتحدث لوحة التحكم في الوقت الفعلي، ثم تُغلق الحالة ويُسجل التبرع.',
  },
  'home.groupsTitle': { fr: 'Qui peut donner à qui ?', ar: 'من يمكنه التبرع لمن؟' },
  'home.groupsSubtitle': {
    fr: 'Compatibilité des globules rouges (GR). Une matrice explicite, testée et documentée.',
    ar: 'توافق كريات الدم الحمراء. مصفوفة صريحة ومختبرة وموثقة.',
  },
  'home.demoNote': {
    fr: 'Les chiffres de cette section proviennent d’un jeu de démonstration clairement identifié, pas de données de production.',
    ar: 'أرقام هذا القسم مأخوذة من مجموعة بيانات تجريبية محددة بوضوح، وليست بيانات إنتاج.',
  },
  'home.trustTitle': { fr: 'La confiance se construit dans les détails', ar: 'الثقة تُبنى في التفاصيل' },
  'home.trust1': { fr: 'Votre position précise n’est jamais publiée.', ar: 'موقعك الدقيق لا يُنشر أبداً.' },
  'home.trust2': { fr: 'Consentement explicite pour la géolocalisation et les alertes.', ar: 'موافقة صريحة على الموقع الجغرافي والتنبيهات.' },
  'home.trust3': { fr: 'Éligibilité indicative, jamais une validation médicale.', ar: 'الأهلية إرشادية وليست تحققاً طبياً.' },
  'home.trust4': { fr: 'Accès aux données strictement limité par rôle.', ar: 'الوصول إلى البيانات مقيد بدقة حسب الدور.' },
  'home.finalTitle': { fr: 'Prêt à offrir ce que vous avez de plus précieux ?', ar: 'هل أنت مستعد لتقديم أغلى ما تملك؟' },
  'home.finalText': {
    fr: 'Inscrivez-vous en deux minutes, renseignez votre groupe sanguin et recevez uniquement les alertes qui vous concernent.',
    ar: 'سجّل في دقيقتين، أدخل فصيلة دمك، واستقبل فقط التنبيهات التي تخصك.',
  },
  'how.title': { fr: 'Le fonctionnement de SOS Sang', ar: 'كيف تعمل منصة SOS دم' },
  'how.intro': {
    fr: 'Chaque urgence suit un chemin contrôlé : validation, sélection des donneurs, notification, réponse puis confirmation atomique.',
    ar: 'كل حالة تمر بمسار مُراقب: التحقق، اختيار المتبرعين، الإشعار، الرد ثم التأكيد الذري.',
  },
  'groups.title': { fr: 'Les groupes sanguins', ar: 'فصائل الدم' },
  'groups.intro': {
    fr: 'Le système ABO et le facteur RhD définissent 8 groupes. Cette page explique la compatibilité des globules rouges, pas la compatibilité plasma ou plaquettes.',
    ar: 'يحدد نظام ABO وعامل RhD ثماني فصائل. توضح هذه الصفحة توافق كريات الدم الحمراء فقط.',
  },
  'groups.donorCanGive': { fr: 'Peut donner à', ar: 'يمكنه التبرع لـ' },
  'groups.receiveFrom': { fr: 'Peut recevoir de', ar: 'يمكنه الاستقبال من' },
  'groups.universalDonor': { fr: 'Donneur universel (GR)', ar: 'متبرع عام (كريات حمراء)' },
  'groups.universalRecipient': { fr: 'Receveur universel (GR)', ar: 'مستقبل عام (كريات حمراء)' },
  'auth.loginTitle': { fr: 'Connexion', ar: 'تسجيل الدخول' },
  'auth.loginSubtitle': { fr: 'Accédez à votre espace donneur, hôpital ou administrateur.', ar: 'ادخل إلى فضاء المتبرع أو المستشفى أو الإدارة.' },
  'auth.email': { fr: 'E-mail', ar: 'البريد الإلكتروني' },
  'auth.password': { fr: 'Mot de passe', ar: 'كلمة المرور' },
  'auth.login': { fr: 'Se connecter', ar: 'دخول' },
  'auth.noAccount': { fr: 'Pas encore de compte ?', ar: 'ليس لديك حساب؟' },
  'auth.registerDonor': { fr: 'Devenir donneur', ar: 'كن متبرعاً' },
  'auth.registerHospital': { fr: 'Inscrire mon hôpital', ar: 'تسجيل مستشفى' },
  'auth.registerTitle': { fr: 'Créer un compte', ar: 'إنشاء حساب' },
  'auth.donorTab': { fr: 'Donneur', ar: 'متبرع' },
  'auth.hospitalTab': { fr: 'Hôpital', ar: 'مستشفى' },
  'auth.firstName': { fr: 'Prénom', ar: 'الاسم الشخصي' },
  'auth.lastName': { fr: 'Nom', ar: 'الاسم العائلي' },
  'auth.phone': { fr: 'Téléphone', ar: 'الهاتف' },
  'auth.city': { fr: 'Ville', ar: 'المدينة' },
  'auth.bloodGroup': { fr: 'Groupe sanguin', ar: 'فصيلة الدم' },
  'auth.hospitalName': { fr: 'Nom de l’établissement', ar: 'اسم المؤسسة' },
  'auth.contactName': { fr: 'Nom du contact', ar: 'اسم المسؤول' },
  'auth.address': { fr: 'Adresse', ar: 'العنوان' },
  'auth.consentNotif': {
    fr: 'J’accepte de recevoir des alertes par e-mail, SMS et notification web lorsque mon groupe est compatible.',
    ar: 'أوافق على تلقي تنبيهات بالبريد والرسائل القصيرة والإشعارات عندما تكون فصيلتي متوافقة.',
  },
  'auth.consentLocation': {
    fr: 'J’accepte que ma position approximative soit utilisée pour calculer la distance des hôpitaux.',
    ar: 'أوافق على استخدام موقعي التقريبي لحساب المسافة إلى المستشفيات.',
  },
  'auth.hospitalPending': {
    fr: 'Votre compte sera examiné par un administrateur avant l’accès à l’espace hospitalier.',
    ar: 'سيتم مراجعة حسابك من قبل الإدارة قبل الوصول إلى فضاء المستشفى.',
  },
  'auth.accountCreated': { fr: 'Compte créé avec succès.', ar: 'تم إنشاء الحساب بنجاح.' },
  'auth.hospitalCreated': {
    fr: 'Compte établissement créé. Il doit maintenant être validé par un administrateur.',
    ar: 'تم إنشاء حساب المؤسسة. يجب أن تعتمده الإدارة الآن.',
  },
  'auth.demoTitle': { fr: 'Comptes de démonstration', ar: 'حسابات تجريبية' },
  'auth.demoHint': {
    fr: 'Après `npm run seed`, ces comptes fictifs existent avec le mot de passe Demo!Passw0rd.',
    ar: 'بعد تنفيذ `npm run seed` توجد هذه الحسابات الوهمية بكلمة المرور Demo!Passw0rd.',
  },
  'donor.space': { fr: 'Espace donneur', ar: 'فضاء المتبرع' },
  'donor.available': { fr: 'Disponible', ar: 'متاح' },
  'donor.unavailable': { fr: 'Indisponible', ar: 'غير متاح' },
  'donor.eligibility': { fr: 'Éligibilité indicative', ar: 'الأهلية الإرشادية' },
  'donor.eligible': { fr: 'Aucun blocage détecté', ar: 'لا توجد عوائق' },
  'donor.notEligible': { fr: 'Don non recommandé pour le moment', ar: 'التبرع غير موصى به حالياً' },
  'donor.nextEligible': { fr: 'Prochaine date possible', ar: 'التاريخ التالي الممكن' },
  'donor.alertsReceived': { fr: 'Alertes reçues', ar: 'التنبيهات المستلمة' },
  'donor.responses': { fr: 'Réponses données', ar: 'الردود' },
  'donor.confirmations': { fr: 'Venues confirmées', ar: 'الحضور المؤكد' },
  'donor.donations': { fr: 'Dons enregistrés', ar: 'التبرعات المسجلة' },
  'donor.compatibleTitle': { fr: 'Urgences compatibles à proximité', ar: 'حالات مستعجلة متوافقة قريبة' },
  'donor.noCompatible': { fr: 'Aucune urgence compatible ouverte pour votre groupe actuellement.', ar: 'لا توجد حالة مستعجلة متوافقة مفتوحة لفصيلتك حالياً.' },
  'donor.iAmComing': { fr: 'J’arrive', ar: 'سآتي' },
  'donor.iCannot': { fr: 'Je ne peux pas', ar: 'لا أستطيع' },
  'donor.myAlerts': { fr: 'Mes alertes', ar: 'تنبيهاتي' },
  'donor.markRead': { fr: 'Tout marquer comme lu', ar: 'تعليم الكل كمقروء' },
  'donor.disclaimer': {
    fr: 'L’éligibilité affichée est un calcul indicatif basé sur les règles configurées (délai entre dons, âge, poids). Ce n’est pas une validation médicale : seul le centre de transfusion décide de l’aptitude au don.',
    ar: 'الأهلية المعروضة حساب إرشادي يعتمد على القواعد المحددة (الفاصل بين التبرعين، العمر، الوزن). ليست تحققاً طبياً: فقط مركز نقل الدم يقرر الأهلية.',
  },
  'donor.locationTitle': { fr: 'Ma localisation', ar: 'موقعي' },
  'donor.locationHelp': {
    fr: 'Votre position n’est jamais affichée publiquement : elle sert uniquement à calculer une distance et à trier les alertes.',
    ar: 'لا يُعرض موقعك علناً أبداً: يُستخدم فقط لحساب المسافة وترتيب التنبيهات.',
  },
  'donor.useMyPosition': { fr: 'Utiliser ma position actuelle', ar: 'استخدام موقعي الحالي' },
  'donor.consentWithdraw': { fr: 'Retirer mon consentement de localisation', ar: 'سحب موافقة الموقع' },
  'hospital.space': { fr: 'Espace hôpital', ar: 'فضاء المستشفى' },
  'hospital.activeUrgences': { fr: 'Urgences actives', ar: 'حالات نشطة' },
  'hospital.covered': { fr: 'Couvertes', ar: 'مغطاة' },
  'hospital.pending': { fr: 'En attente', ar: 'قيد الانتظار' },
  'hospital.closed': { fr: 'Clôturées', ar: 'مغلقة' },
  'hospital.declare': { fr: 'Déclarer une urgence', ar: 'الإعلان عن حالة مستعجلة' },
  'hospital.declareSubtitle': {
    fr: 'La demande est publiée immédiatement et les donneurs compatibles sont alertés en quelques secondes.',
    ar: 'يُنشر الطلب فوراً ويتم تنبيه المتبرعين المتوافقين في ثوانٍ.',
  },
  'hospital.bagsNeeded': { fr: 'Poches nécessaires', ar: 'عدد الأكياس' },
  'hospital.bagsConfirmed': { fr: 'Poches confirmées', ar: 'الأكياس المؤكدة' },
  'hospital.deadline': { fr: 'Échéance', ar: 'الأجل' },
  'hospital.notes': { fr: 'Contexte clinique (facultatif)', ar: 'السياق السريري (اختياري)' },
  'hospital.contactPhone': { fr: 'Téléphone de contact', ar: 'هاتف الاتصال' },
  'hospital.contacted': { fr: 'Contactés', ar: 'تم التواصل' },
  'hospital.coming': { fr: 'En route', ar: 'في الطريق' },
  'hospital.confirmed': { fr: 'Confirmés', ar: 'مؤكدون' },
  'hospital.declined': { fr: 'Indisponibles', ar: 'غير متاحين' },
  'hospital.responders': { fr: 'Donneurs mobilisés', ar: 'المتبرعون' },
  'hospital.realtime': { fr: 'Temps réel', ar: 'وقت فعلي' },
  'hospital.closeUrgence': { fr: 'Clôturer et enregistrer les dons', ar: 'إغلاق وتسجيل التبرعات' },
  'hospital.cancelUrgence': { fr: 'Annuler l’urgence', ar: 'إلغاء الحالة' },
  'hospital.map': { fr: 'Carte des donneurs mobilisés', ar: 'خريطة المتبرعين' },
  'hospital.mapNote': {
    fr: 'Positions approximatives. Aucune coordonnée précise de donneur n’est exposée.',
    ar: 'مواقع تقريبية. لا يتم إفشاء أي إحداثيات دقيقة للمتبرع.',
  },
  'hospital.stockTitle': { fr: 'Stocks de sang', ar: 'مخزون الدم' },
  'hospital.stockLow': { fr: 'Seuil bas', ar: 'مستوى منخفض' },
  'hospital.stockOk': { fr: 'Suffisant', ar: 'كافٍ' },
  'hospital.setUnits': { fr: 'Définir', ar: 'تحديد' },
  'hospital.pendingValidation': { fr: 'Compte en attente de validation', ar: 'حساب في انتظار الاعتماد' },
  'hospital.pendingText': {
    fr: 'Votre établissement est enregistré mais l’accès à l’espace hospitalier sera ouvert après validation par un administrateur.',
    ar: 'تم تسجيل مؤسستك، وسيُفتح الوصول بعد اعتماد الإدارة.',
  },
  'admin.space': { fr: 'Administration', ar: 'الإدارة' },
  'admin.overview': { fr: 'Vue d’ensemble', ar: 'نظرة عامة' },
  'admin.urgencesDeclared': { fr: 'Urgences déclarées', ar: 'حالات معلنة' },
  'admin.bagsCollected': { fr: 'Poches collectées', ar: 'أكياس مجمعة' },
  'admin.donorsMobilized': { fr: 'Donneurs mobilisés', ar: 'متبرعون' },
  'admin.avgMobilisation': { fr: 'Délai moyen', ar: 'متوسط الزمن' },
  'admin.pendingHospitals': { fr: 'Hôpitaux à valider', ar: 'مستشفيات للاعتماد' },
  'admin.approve': { fr: 'Valider', ar: 'اعتماد' },
  'admin.reject': { fr: 'Refuser', ar: 'رفض' },
  'admin.suspend': { fr: 'Suspendre', ar: 'تعليق' },
  'admin.reactivate': { fr: 'Réactiver', ar: 'إعادة التنشيط' },
  'admin.changeRole': { fr: 'Changer le rôle', ar: 'تغيير الدور' },
  'admin.notifStats': { fr: 'Supervision des notifications', ar: 'مراقبة الإشعارات' },
  'admin.avgLatency': { fr: 'Latence moyenne', ar: 'متوسط الكمون' },
  'admin.maxLatency': { fr: 'Latence maximale', ar: 'أقصى كمون' },
  'admin.p95Latency': { fr: 'Latence p95', ar: 'الكمون p95' },
  'admin.failed': { fr: 'Échecs', ar: 'فشل' },
  'admin.retryNotif': { fr: 'Renvoyer', ar: 'إعادة الإرسال' },
  'admin.events': { fr: 'Derniers événements', ar: 'آخر الأحداث' },
  'admin.servicesUp': { fr: 'services opérationnels', ar: 'خدمات تعمل' },
  'admin.healthCheck': { fr: 'Vérifier maintenant', ar: 'تحقق الآن' },
  'admin.role': { fr: 'Rôle', ar: 'الدور' },
  'admin.auditLog': { fr: 'Journal d’audit', ar: 'سجل التدقيق' },
  'admin.notifSupervision': { fr: 'Notifications', ar: 'الإشعارات' },
  'contact.title': { fr: 'Contact', ar: 'اتصل بنا' },
  'contact.intro': {
    fr: 'Une question sur le don, un problème d’accès ou un partenariat hospitalier ? Écrivez-nous.',
    ar: 'سؤال عن التبرع، مشكلة في الوصول أو شراكة مع مستشفى؟ راسلنا.',
  },
  'contact.sent': {
    fr: 'Message enregistré localement. L’envoi d’e-mails réels est simulé dans cette version de démonstration.',
    ar: 'تم حفظ الرسالة محلياً. إرسال البريد الحقيقي محاكاة في هذه النسخة.',
  },
  'contact.message': { fr: 'Votre message', ar: 'رسالتك' },
  'contact.send': { fr: 'Envoyer le message', ar: 'إرسال الرسالة' },
  'privacy.title': { fr: 'Confidentialité et données personnelles', ar: 'الخصوصية والبيانات الشخصية' },
  'privacy.intro': {
    fr: 'SOS Sang collecte le minimum de données nécessaire pour mettre en relation un hôpital et un donneur compatible.',
    ar: 'تجمع SOS دم الحد الأدنى من البيانات اللازمة للربط بين المستشفى والمتبرع المتوافق.',
  },
  'footer.rights': { fr: 'Projet académique — données fictives.', ar: 'مشروع أكاديمي — بيانات وهمية.' },
  'footer.notMedical': {
    fr: 'SOS Sang ne remplace ni un avis médical ni la décision d’un centre de transfusion.',
    ar: 'لا تحل SOS دم محل الرأي الطبي أو قرار مركز نقل الدم.',
  },
};

interface I18nValue {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatDate: (value: string | Date | null | undefined) => string;
  formatDateTime: (value: string | Date | null | undefined) => string;
  formatNumber: (value: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);
const LANG_KEY = 'sos.lang';

function pickInitialLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === 'ar' || stored === 'fr') return stored;
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'fr';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(pickInitialLang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem(LANG_KEY, lang);
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const entry = DICT[key];
      let out = entry ? entry[lang] : key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
      }
      return out;
    },
    [lang],
  );

  const locale = lang === 'ar' ? 'ar-TN' : 'fr-FR';
  const formatDate = useCallback(
    (value: string | Date | null | undefined) =>
      value ? new Date(value).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    [locale],
  );
  const formatDateTime = useCallback(
    (value: string | Date | null | undefined) =>
      value
        ? new Date(value).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—',
    [locale],
  );
  const formatNumber = useCallback((value: number) => new Intl.NumberFormat(locale).format(value), [locale]);

  const value = useMemo<I18nValue>(
    () => ({ lang, dir, setLang, t, formatDate, formatDateTime, formatNumber }),
    [lang, dir, setLang, t, formatDate, formatDateTime, formatNumber],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n doit etre utilise dans I18nProvider');
  return ctx;
}
