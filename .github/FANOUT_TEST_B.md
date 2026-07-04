# FANOUT_TEST_B

repository-fanout v2 の削除追従(retraction)E2E 検証用の一時ファイル。

- 役割: 配布後に**配布先で改変してから**正本を削除し、「消さずに残置+PR 本文注記+Discord 通知」の
  引き渡し経路を実証する(spec v2 §5.4 / P4 Phase D4 の改変ケース)
- 検証手順の中で配布先(repository-fanout)側のこのファイルに 1 行追記する
- 検証完了後、残置されたファイルは手動で削除する
