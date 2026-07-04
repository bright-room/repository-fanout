# FANOUT_TEST_A

repository-fanout v2 の削除追従(retraction)E2E 検証用の一時ファイル。

- 役割: 配布後に正本から削除し、配布先へ**削除 PR が出る**ことを実証する(spec v2 §5.4 / P4 Phase D4)
- 配布先では改変しないこと(ハッシュ一致 = fanout が配ったまま、の削除経路を検証する)
- 検証完了後、このファイルは正本・配布先の双方から消える
