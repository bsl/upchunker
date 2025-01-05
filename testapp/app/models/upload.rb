class Upload < ApplicationRecord
  before_create do
    self.uuid = SecureRandom.uuid_v4
  end
end
