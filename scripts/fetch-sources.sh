#!/bin/zsh
# BodyParts3D 4.0（DBCLS, CC BY 4.0）を data-raw/bp3d/ に取得する。data-raw/ は git の対象外。
# 出典表記: "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International"
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST"
DEST="data-raw/bp3d"
mkdir -p "$DEST"
for f in isa_parts_list_e.txt partof_parts_list_e.txt isa_element_parts.txt partof_element_parts.txt isa_inclusion_relation_list.txt partof_inclusion_relation_list.txt; do
  [ -s "$DEST/$f" ] || curl -fsSL "$BASE/$f" -o "$DEST/$f"
done
if [ ! -d "$DEST/obj" ]; then
  [ -s "$DEST/isa_BP3D_4.0_obj_99.zip" ] || curl -fSL "$BASE/isa_BP3D_4.0_obj_99.zip" -o "$DEST/isa_BP3D_4.0_obj_99.zip"
  mkdir -p "$DEST/obj"
  unzip -q -j "$DEST/isa_BP3D_4.0_obj_99.zip" '*.obj' -d "$DEST/obj"
fi
echo "obj files: $(ls "$DEST/obj" | wc -l)"
