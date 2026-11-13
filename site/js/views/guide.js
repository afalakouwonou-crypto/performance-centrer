// Wakabi Performance Center — Écran : guide
"use strict";
function help(){
 setHead("Guide","La routine Wakabi et les règles de calcul");
 const pf=namesFr(pubPlatforms().map(f=>f.name));
 $("#page").innerHTML=`<div class="grid two">
 ${card("La routine",`<ol class="steps">
  <li><strong>Planifier</strong> : la rédaction crée <strong>une seule fiche</strong> par contenu (titre, concept, rubrique, date prévue…).</li>
  <li><strong>Publier</strong> : sur la fiche, elle ajoute le lien de chaque plateforme (${esc(pf)}) et la date effective de publication.</li>
  <li><strong>Mesurer</strong> : à J+1 puis à J+7, le responsable de chaque plateforme saisit vues, likes, commentaires et partages (republications et enregistrements si la plateforme les fournit). La cloche et la page Saisie indiquent quoi faire.</li>
  <li><strong>Analyser</strong> : les pages Aujourd’hui, Performance et Direction se mettent à jour seules.</li>
  <li><strong>Décider</strong> : garder, réinventer ou abandonner ce qui ne fonctionne pas.</li></ol>`)}
 ${card("Formules (validées le 30 octobre 2026)",`<dl class="defs">
  <dt>Interactions</dt><dd>likes + commentaires + partages.</dd>
  <dt>Taux d’interaction</dt><dd>interactions ÷ vues × 100, affiché seulement si les vues sont supérieures à 0 (sinon « N/D »).</dd>
  <dt>Taux d’un ensemble</dt><dd>somme des interactions ÷ somme des vues (taux pondéré). On n’additionne jamais des pourcentages.</dd>
  <dt>Republications, enregistrements</dt><dd>affichés à part, jamais inclus dans le taux. Case vide = « N/D », différent de 0.</dd>
  <dt>Évolution</dt><dd>valeur récente − valeur précédente ; en % seulement si la valeur précédente est supérieure à 0. Pour un taux, l’écart est donné en points (pt).</dd>
  <dt>Relevé de référence</dt><dd>J+1, J+7 ou dernier relevé : un seul relevé par publication. J+1 et J+7 ne s’additionnent jamais.</dd>
  <dt>Vues sur plusieurs plateformes</dt><dd>un volume de vues, pas un nombre de personnes.</dd></dl>`)}
 </div>
 <div class="grid two">
 ${card("Échéances J+1 / J+7",`<ul class="plain">
  <li>Calculées depuis la <strong>date effective</strong> de chaque publication ; à défaut, depuis la date prévue du contenu (affichée comme « estimée »).</li>
  <li><strong>J+1</strong> : demandé le jour J+1 et le lendemain ; au-delà, il est « manqué » et ne se saisit plus comme J+1. Échéances antérieures au 30/10/2026 : « non suivies ».</li>
  <li><strong>J+7</strong> : demandé tant qu’il manque. Ensuite, des relevés de suivi peuvent être ajoutés depuis la fiche.</li>
  <li>Une correction est un nouveau relevé avec un motif ; l’ancien reste dans l’historique.</li>
  <li>« Aujourd’hui » suit le fuseau du pays du contenu : Lomé (UTC+0), Porto-Novo (UTC+1).</li></ul>`)}
 ${card("Repères internes",`<ul class="plain">
  <li><strong>Ce qui marche / à surveiller</strong> : classement par taux d’interaction, seulement pour les contenus d’au moins ${MIN_VIEWS_RANK} vues sur la période.</li>
  <li><strong>Désinstallations</strong> : signalées quand elles dépassent ${UNINSTALL_ALERT*100} % des téléchargements du mois.</li>
  <li><strong>Baisse du taux</strong> : signalée (page Direction) quand le taux pondéré d’une plateforme baisse d’au moins ${RATE_DROP_ALERT*100} point sur 30 jours, avec au moins ${MIN_SAMPLE} publications mesurées de chaque côté.</li>
  <li><strong>Échantillon faible</strong> : un groupe de moins de ${MIN_SAMPLE} publications mesurées est signalé dans « Comparer le comparable » ; sa moyenne est fragile.</li>
  <li><strong>Périodes</strong> : une publication est rattachée à sa date effective (sinon prévue) ; la comparaison porte sur la période précédente de même durée.</li></ul>
  <p class="meta">Ce sont des repères de pilotage propres à Wakabi, pas des métriques officielles des plateformes.</p>`)}
 </div>
 ${card("Organisation de l’équipe",`<ul class="plain"><li><strong>États de production</strong> : Idée → À produire → En production → À valider → Validé → Programmé → Publié. Le passage à « Publié » est automatique dès qu’une date effective de publication est saisie.</li><li><strong>Tâches</strong> : la rédaction les crée et les confie ; chacun fait avancer les siennes (à faire → en cours → fait) et les retrouve dans « Mes tâches ». Les droits viennent des tâches confiées, pas d’un rôle de plus.</li><li><strong>Validation</strong> : une personne ayant une tâche propose le contenu « à valider » ; la rédaction valide ou demande une correction (motif obligatoire). Chacun est prévenu dans la cloche.</li><li><strong>Fichiers</strong> : stockage privé, visible par l’équipe connectée seulement ; un fichier se retire, il n’est jamais effacé.</li></ul>`)}
 ${card("Objectifs, imports, connexions",`<ul class="plain"><li><strong>Objectifs</strong> : mensuels, trimestriels ou par campagne, jamais obligatoires par contenu ; calculés avec les mêmes règles que les écrans. Le trait vertical montre la part de la période déjà écoulée.</li><li><strong>Import CSV</strong> : une ligne = un relevé ; les publications sont reconnues par leur identifiant puis par leur lien ; un relevé J+1 / J+7 déjà saisi est ignoré ; chaque import est tracé.</li><li><strong>Connexions</strong> : la synchronisation automatique et la publication directe passeront par les API officielles des plateformes (comptes développeur à obtenir) ; aucun mot de passe de réseau social n’est jamais demandé.</li><li><strong>Diffusion</strong> : chaque publication peut être marquée organique ou sponsorisée ; « non précisé » par défaut.</li><li><strong>Pistes d’action</strong> : repères calculés sur au moins ${MIN_SAMPLE} publications mesurées par groupe, à vérifier avant de décider.</li></ul>`)}
 ${card("Calendrier et rapports",`<ul class="plain"><li><strong>Calendrier</strong> : contenus à leur date prévue, publications à leur date effective, échéances J+1 / J+7. Cliquer un jour ouvre son détail ; cliquer un élément ouvre la fiche.</li><li><strong>Rapports</strong> : hebdomadaire, mensuel, par campagne ou sur une période libre, comparés à la période précédente ; « Imprimer / PDF » pour un document, « Export CSV » pour Excel (séparateur « ; », formules neutralisées).</li><li>Les chiffres des rapports sont calculés exactement comme ceux des écrans.</li></ul>`)}
 ${card("Lire les états",`<div class="legend">${["due","late","done","done_late","upcoming","missed","not_tracked"].map(s=>stateBadge(s)).join("")}</div>`)}`;
}
