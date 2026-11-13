#!/usr/bin/env bash
# Construit une copie LOCALE de la base de production (structure 01 → 07, droits réels) puis ajoute des données
# fictives proches de la production. Ne touche jamais à Supabase.
#   bash supabase/banc-local/construire.sh            -> base « wakabi » sur le port 54329 (dossier .banc/)
#   bash supabase/banc-local/construire.sh --arreter  -> arrête le serveur local
# Prérequis : PostgreSQL 18 (binaires dans PG_BIN, par défaut « C:/Program Files/PostgreSQL/18/bin »).
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"; RACINE="$(cd "$ICI/../.." && pwd)"
PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PORT:-54329}"; DATA="$ICI/.banc"
export PGCLIENTENCODING=UTF8   # fichiers SQL en UTF-8 (sinon psql peut lire les accents en WIN1252)
REF="$RACINE/supabase/reference/reconstruction"
if [ "${1:-}" = "--arreter" ]; then "$PG_BIN/pg_ctl" -D "$DATA" -w stop >/dev/null 2>&1 || true; echo "arrêté"; exit 0; fi
"$PG_BIN/pg_ctl" -D "$DATA" -w stop >/dev/null 2>&1 || true
rm -rf "$DATA"
"$PG_BIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null
# Sorties du serveur fermées (sinon le terminal attend la fin du serveur, qui tourne en arrière-plan).
"$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT" -l "$DATA/serveur.log" -w start >/dev/null 2>&1 </dev/null
P=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${P[@]}" -d postgres -c "create database wakabi"
B=("${P[@]}" -d wakabi)
"${B[@]}" -f "$ICI/stub_supabase.sql"
# Structure de production : schéma du 28/10 + migrations 01 à 05 (fins de ligne CRLF, comme en production).
sed 's/\r$//; s/$/\r/' "$REF/R0a_schema_01_05.sql" | "${B[@]}"
# Premier compte (administrateur), exigé par la 06.
"${B[@]}" -c "insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-4000-8000-000000000001','admin@local.test',now())"
sed "s/ADRESSE_R_ADMIN/admin@local.test/" "$REF/R0_admin_recette.sql" | "${B[@]}"
# 06 (version appliquée), 06b, 07, puis droits et compléments réellement constatés en production.
"${B[@]}" -f "$REF/R0b_06_06b_07.sql"
PGOPTIONS="-c wakabi.copie_locale=oui" "${B[@]}" -f "$REF/R0c_alignement_droits_recette.sql" -f "$REF/R0d_complements_structure_recette.sql" -f "$REF/R0e_fonctions_06b_sources_production.sql"
# Données fictives (comptes, contenus, publications, relevés) proches des volumes de production.
"${B[@]}" -f "$ICI/donnees_fictives.sql"
"${B[@]}" -t -A -c "select 'profils='||(select count(*) from profiles)||' affectations='||(select count(*) from profile_platforms)||' contenus='||(select count(*) from contents)||' publications='||(select count(*) from publications)||' metrics='||(select count(*) from metrics)||' metric_readings='||(select count(*) from metric_readings)"
echo "Copie locale prête : psql -h 127.0.0.1 -p $PORT -U postgres -d wakabi"
