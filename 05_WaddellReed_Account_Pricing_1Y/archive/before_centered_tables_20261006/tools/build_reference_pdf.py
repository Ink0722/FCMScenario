from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from build_case_documents import build_case
if __name__=='__main__':build_case(5)
