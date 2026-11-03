#!/bin/zsh
# BodyParts3D 4.0（DBCLS, CC BY 4.0）を data-raw/bp3d/ に、3.0 の細かい形を data-raw/bp3d-v3/ に、Z-Anatomy の FBX を data-raw/z-anatomy/ に取得する。data-raw/ は git の対象外。
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

# BodyParts3D 3.0 の細かい形（ポリゴンを95%減らした版。4.0 は99%減らした版だけ）。約520MB。
# scripts/hires.mjs が 4.0 の形に重ねて、表示用の形に使う。ZIP の中の区切りが \ なので、展開してから平らにする。
V3="data-raw/bp3d-v3"
mkdir -p "$V3"
if [ ! -d "$V3/obj" ]; then
  [ -s "$V3/BodyParts3D_3.0_obj_95.zip" ] || curl -fSL "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20110915/BodyParts3D_3.0_obj_95.zip" -o "$V3/BodyParts3D_3.0_obj_95.zip"
  mkdir -p "$V3/obj"
  (cd "$V3/obj" && unzip -q -o ../BodyParts3D_3.0_obj_95.zip && mv BodyParts3D_3.0_obj_95/* . && rmdir BodyParts3D_3.0_obj_95)
fi
echo "BodyParts3D 3.0 obj files: $(ls "$V3/obj" | wc -l)"

# Z-Anatomy（CC BY-SA 4.0）の FBX。BodyParts3D に無い構造（靱帯・リンパ節を含む）を骨に合わせて取り込む（scripts/za/）。約230MB。
ZA="https://raw.githubusercontent.com/LluisV/Z-Anatomy/PC-Version/Resources/Models/FBX"
mkdir -p data-raw/z-anatomy
for f in SkeletalSystem100 MuscularSystem100 NervousSystem100 VisceralSystem100 CardioVascular41 Joints100 LymphoidOrgans100; do
  [ -s "data-raw/z-anatomy/$f.fbx" ] || curl -fSL "$ZA/$f.fbx" -o "data-raw/z-anatomy/$f.fbx"
done

# NasalSeg（CC BY 4.0。https://zenodo.org/records/13893419）。鼻腔・上顎洞のラベルつきの CT 130例（約224MB）。
# 1例（scripts/nasal/index.mjs の NASAL_CASE）から scripts/nasal/nasalseg.py で鼻腔・鼻道・鼻甲介・上顎洞の形を作る（Python 3 の numpy と scipy が要る）。
NS="data-raw/nasalseg"
mkdir -p "$NS"
if [ ! -d "$NS/labels" ]; then
  [ -s "$NS/NasalSeg.zip" ] || curl -fSL "https://zenodo.org/records/13893419/files/NasalSeg.zip?download=1" -o "$NS/NasalSeg.zip"
  (cd "$NS" && unzip -q -o NasalSeg.zip)
fi
[ -s "$NS/P065.json" ] || python3 scripts/nasal/nasalseg.py "$NS" P065 "$NS/P065.json"
