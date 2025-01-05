class AddUploads < ActiveRecord::Migration[8.0]
  def change
    create_table :uploads do |t|
      t.string :file_name
      t.integer :file_size
      t.integer :file_num_chunks
      t.string :file_digest
      t.string :uuid, index: { unique: true }

      t.timestamps
    end
  end
end
