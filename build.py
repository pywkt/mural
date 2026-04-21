import os
import gzip
import shutil
Import("env")

GZIP_EXTENSIONS = {'.html', '.css', '.js', '.svg', '.json'}

project_dir = env.subst("$PROJECT_DIR")
staging_root = os.path.join(env.subst("$BUILD_DIR"), "fs_data")
staging_www = os.path.join(staging_root, "www")

if os.path.exists(staging_root):
    shutil.rmtree(staging_root)
os.makedirs(staging_www)

print("Copying data/www -> " + staging_www)
shutil.copytree(os.path.join(project_dir, "data", "www"), staging_www, dirs_exist_ok=True)

print("Gzipping static assets in " + staging_www)
total_orig = 0
total_gz = 0
for root, _, files in os.walk(staging_www):
    for filename in list(files):
        if filename.endswith('.gz'):
            continue
        ext = os.path.splitext(filename)[1].lower()
        if ext not in GZIP_EXTENSIONS:
            continue
        path = os.path.join(root, filename)
        gz_path = path + '.gz'
        orig_size = os.path.getsize(path)
        with open(path, 'rb') as f_in, gzip.open(gz_path, 'wb', compresslevel=9) as f_out:
            shutil.copyfileobj(f_in, f_out)
        os.remove(path)
        gz_size = os.path.getsize(gz_path)
        total_orig += orig_size
        total_gz += gz_size
        pct = (100 * gz_size) // orig_size if orig_size else 0
        rel = os.path.relpath(path, staging_www)
        print("  {}: {} -> {} ({}%)".format(rel, orig_size, gz_size, pct))
if total_orig > 0:
    saved = total_orig - total_gz
    pct = (100 * total_gz) // total_orig
    print("  Total: {} -> {} ({}%, saved {} bytes)".format(total_orig, total_gz, pct, saved))

env.Replace(PROJECT_DATA_DIR=staging_root)
