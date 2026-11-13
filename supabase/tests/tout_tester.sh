#!/usr/bin/env bash
# Teste TOUTES les migrations à appliquer, sur une copie locale neuve de la production (jamais sur Supabase).
#   bash supabase/tests/tout_tester.sh
# Étapes : construire la copie -> empreintes -> 08P, 09, 10, 11 -> tests -> refus d'une 2e exécution ->
#          annulations 11, 10, 09 (ordre inverse) -> réinstallation 09, 10 -> tests -> empreintes identiques.
set -uo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"; RACINE="$(cd "$ICI/../.." && pwd)"; M="$RACINE/supabase/migrations"
PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PORT:-54329}"
export PGCLIENTENCODING=UTF8
P=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -X -q -d wakabi)
echecs=0
etape() { echo "— $*"; }
appliquer() { if "${P[@]}" -v ON_ERROR_STOP=1 -f "$M/$1.sql" >/dev/null 2>/tmp/wk_err.txt; then echo "  ok   $1"; else echo "  ÉCHEC $1"; sed 's/^/       /' /tmp/wk_err.txt; echecs=$((echecs+1)); fi; }
refuse() { if "${P[@]}" -v ON_ERROR_STOP=1 -f "$M/$1.sql" >/dev/null 2>/tmp/wk_err.txt; then echo "  ÉCHEC $1 : 2e exécution acceptée"; echecs=$((echecs+1)); else echo "  ok   $1 : 2e exécution refusée ($(grep -o 'ERROR: .*' /tmp/wk_err.txt | head -1 | cut -c8-70))"; fi; }
tester() { local out; out="$("${P[@]}" -v ON_ERROR_STOP=1 -f "$ICI/$1.sql" 2>&1)"; local n; n=$(grep -c "OK  " <<<"$out");
  if grep -q "RÉUSSIS" <<<"$out"; then echo "  ok   $1 ($n tests)"; else echo "  ÉCHEC $1"; grep -E "ÉCHEC|ERROR" <<<"$out" | head -3 | sed 's/^/       /'; echecs=$((echecs+1)); fi; }
empreintes() { "${P[@]}" -t -A -f "$RACINE/supabase/controles/empreintes_donnees.sql"; }

etape "Copie locale de la production"; bash "$RACINE/supabase/banc-local/construire.sh" | tail -2 | head -1
avant="$(empreintes)"
etape "Application dans l'ordre"; for m in 08P_identifiants_sessions 09_organisation 10_analyse_imports 11_durcissement_anon; do appliquer $m; done
etape "Tests"; for t in t08P_identifiants t09_organisation t10_analyse_imports; do tester $t; done
anon="$("${P[@]}" -t -A -c "select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and table_name in ('rubriques','platforms','content_types','campaigns','content_objectives','activity_log')")"
[ "$anon" = "0" ] && echo "  ok   11 : plus aucun droit anon sur les listes et le journal" || { echo "  ÉCHEC 11 : $anon droits anon restants"; echecs=$((echecs+1)); }
etape "Une 2e exécution est refusée"; for m in 08P_identifiants_sessions 09_organisation 10_analyse_imports; do refuse $m; done
etape "Annulations (ordre inverse)"; for m in 11_durcissement_anon_annulation 10_analyse_imports_annulation 09_organisation_annulation; do appliquer $m; done
[ "$(empreintes)" = "$avant" ] && echo "  ok   données d'origine identiques après annulation" || { echo "  ÉCHEC données modifiées"; echecs=$((echecs+1)); }
etape "Réinstallation"; for m in 09_organisation 10_analyse_imports; do appliquer $m; done
for t in t09_organisation t10_analyse_imports; do tester $t; done
[ "$(empreintes)" = "$avant" ] && echo "  ok   données d'origine identiques à la fin" || { echo "  ÉCHEC données modifiées"; echecs=$((echecs+1)); }
etape "Annulation de la 08P puis réinstallation"; appliquer 10_analyse_imports_annulation; appliquer 09_organisation_annulation; appliquer 08P_identifiants_sessions_annulation
appliquer 08P_identifiants_sessions; appliquer 09_organisation; appliquer 10_analyse_imports; tester t08P_identifiants; tester t09_organisation
echo; if [ $echecs -eq 0 ]; then echo "BASE : TOUT EST VERT"; else echo "BASE : $echecs ÉCHEC(S)"; fi
exit $echecs
