from pathlib import Path
import re

class NameDeriver:
    """
    Stage 6: Dataset Naming
    Cleanses messy filenames into canonical Postgres Table names.
    """
    def derive(self, filename: str) -> str:
        name = Path(filename).stem
        name = name.lower()
        # Replace separators with underscore
        name = re.sub(r'[\s\-\.]+', '_', name)
        # Strip trailing markers
        name = re.sub(r'_v\d+(\.\d+)?$', '', name)        # _v2, _v1.3
        name = re.sub(r'_\d{4}\d{2}\d{2}$', '', name)     # _20240301
        name = re.sub(r'_(final|draft|copy|new|old)$', '', name)  # _final
        name = re.sub(r'_\(\d+\)$', '', name)              # _(1), _(2)
        return name.strip('_')

name_deriver = NameDeriver()
